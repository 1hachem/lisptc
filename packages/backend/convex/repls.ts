import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
	mutation,
	type QueryCtx,
} from "./_generated/server.js";
import { requireChat } from "./lib/auth.js";
import { MAX_REPL_LAYER_BYTES, REPL_LAYER_CHUNK_CHARS } from "./limits.js";
import { appendTo } from "./messages.js";

const PURGE_BATCH = 64;

async function chunksOf(
	ctx: QueryCtx,
	layerId: Id<"replLayers">,
): Promise<string[]> {
	const rows = await ctx.db
		.query("replLayerChunks")
		.withIndex("by_layer", (q) => q.eq("layerId", layerId))
		.collect();
	return rows.map((row) => row.data);
}

async function openRepl(
	ctx: MutationCtx,
	chat: Doc<"chats">,
): Promise<Id<"repls">> {
	const now = Date.now();
	if (chat.replId !== undefined) {
		await ctx.db.patch(chat.replId, {
			state: "open",
			openedAt: now,
			lastActiveAt: now,
		});
		return chat.replId;
	}
	const replId = await ctx.db.insert("repls", {
		workspaceId: chat.workspaceId,
		chatId: chat._id,
		state: "open",
		openedAt: now,
		lastActiveAt: now,
	});
	await ctx.db.patch(chat._id, { replId });
	return replId;
}

export async function forkRepl(
	ctx: MutationCtx,
	chat: Pick<Doc<"chats">, "_id" | "workspaceId">,
	head: Id<"replLayers">,
): Promise<Id<"repls">> {
	if ((await ctx.db.get(head)) === null)
		throw new ConvexError({ code: "NO_CHECKPOINT" });
	const replId = await ctx.db.insert("repls", {
		workspaceId: chat.workspaceId,
		chatId: chat._id,
		state: "closed",
		head,
	});
	await ctx.db.patch(chat._id, { replId });
	return replId;
}

export async function dropRepl(
	ctx: MutationCtx,
	chat: Doc<"chats">,
): Promise<void> {
	if (chat.replId === undefined) return;
	const repl = await ctx.db.get(chat.replId);
	if (repl === null) return;
	await ctx.db.delete(repl._id);
	await ctx.scheduler.runAfter(0, internal.repls.purge, {
		replId: repl._id,
		head: repl.head,
	});
}

export const open = mutation({
	args: { chatId: v.id("chats") },
	returns: v.id("repls"),
	handler: async (ctx, { chatId }) =>
		await openRepl(ctx, (await requireChat(ctx, chatId)).chat),
});

export const closeChat = internalMutation({
	args: { chatId: v.id("chats"), saved: v.boolean() },
	returns: v.null(),
	handler: async (ctx, { chatId, saved }) => {
		const chat = await ctx.db.get(chatId);
		if (chat?.replId === undefined) return null;
		if ((await ctx.db.get(chat.replId)) === null) return null;
		await ctx.db.patch(chat.replId, {
			state: "closed",
			closedAt: Date.now(),
			closedSaved: saved,
		});
		await appendTo(ctx, chat, [
			{
				type: "system",
				content: saved
					? "The REPL sat idle, so it was saved and closed. It reopens where it stopped on the next message."
					: "The REPL sat idle and was closed, but its last state could not be saved. It reopens from its last checkpoint on the next message.",
				kwargs: { source: "repl" },
			},
		]);
		return null;
	},
});

async function standing(
	ctx: QueryCtx,
	replId: Id<"repls">,
): Promise<Doc<"repls">> {
	const repl = await ctx.db.get(replId);
	if (repl === null) throw new ConvexError({ code: "NOT_FOUND" });
	return repl;
}

async function settleMessages(
	ctx: MutationCtx,
	chatId: Id<"chats">,
	layer: Doc<"replLayers">,
): Promise<void> {
	if (layer.origin === undefined) return;
	const { origin } = layer;
	const from = await ctx.db
		.query("messages")
		.withIndex("by_chat_wire", (q) =>
			q.eq("chatId", chatId).eq("wireId", origin),
		)
		.first();
	if (from === null) return;
	const after = ctx.db
		.query("messages")
		.withIndex("by_chat_seq", (q) =>
			q.eq("chatId", chatId).gte("seq", from.seq),
		);
	for await (const message of after) {
		if (message.layerId !== layer.parent) break;
		await ctx.db.patch(message._id, { layerId: layer._id });
	}
}

export const record = internalMutation({
	args: {
		replId: v.id("repls"),
		over: v.optional(v.id("replLayers")),
		origin: v.optional(v.string()),
		whole: v.boolean(),
		chunks: v.array(v.string()),
	},
	returns: v.id("replLayers"),
	handler: async (ctx, { replId, over, origin, whole, chunks }) => {
		const repl = await standing(ctx, replId);
		const bytes = chunks.reduce(
			(sum, chunk) => sum + new TextEncoder().encode(chunk).length,
			0,
		);
		if (bytes > MAX_REPL_LAYER_BYTES)
			throw new ConvexError({ code: "TOO_LARGE", bytes });
		if (chunks.some((chunk) => chunk.length > REPL_LAYER_CHUNK_CHARS))
			throw new ConvexError({ code: "CHUNK_TOO_LARGE" });
		if (!whole && over !== repl.head)
			throw new ConvexError({ code: "STALE_HEAD" });
		const parent = repl.head === undefined ? null : await ctx.db.get(repl.head);
		const layerId = await ctx.db.insert("replLayers", {
			replId,
			parent: parent?._id,
			origin,
			depth: (parent?.depth ?? 0) + 1,
			whole,
			bytes,
			chunks: chunks.length,
		});
		for (const [index, data] of chunks.entries())
			await ctx.db.insert("replLayerChunks", { layerId, index, data });
		await ctx.db.patch(replId, { head: layerId, lastActiveAt: Date.now() });
		const layer = await ctx.db.get(layerId);
		if (layer !== null && repl.chatId !== undefined)
			await settleMessages(ctx, repl.chatId, layer);
		return layerId;
	},
});

export const latest = internalQuery({
	args: { replId: v.id("repls") },
	returns: v.union(
		v.object({
			head: v.id("replLayers"),
			depth: v.number(),
			layers: v.array(v.array(v.string())),
		}),
		v.null(),
	),
	handler: async (ctx, { replId }) => {
		const repl = await standing(ctx, replId);
		const head = repl.head === undefined ? null : await ctx.db.get(repl.head);
		if (head === null) return null;
		const layers: string[][] = [];
		for (let at: Doc<"replLayers"> | null = head; at !== null; ) {
			layers.unshift(await chunksOf(ctx, at._id));
			if (at.whole || at.parent === undefined) break;
			at = await ctx.db.get(at.parent);
		}
		return { head: head._id, depth: head.depth, layers };
	},
});

async function referenced(
	ctx: QueryCtx,
	layerId: Id<"replLayers">,
): Promise<boolean> {
	const child = await ctx.db
		.query("replLayers")
		.withIndex("by_parent", (q) => q.eq("parent", layerId))
		.first();
	if (child !== null) return true;
	const repl = await ctx.db
		.query("repls")
		.withIndex("by_head", (q) => q.eq("head", layerId))
		.first();
	if (repl !== null) return true;
	const messages = ctx.db
		.query("messages")
		.withIndex("by_layer", (q) => q.eq("layerId", layerId));
	for await (const message of messages)
		if ((await ctx.db.get(message.chatId)) !== null) return true;
	return false;
}

async function collect(
	ctx: MutationCtx,
	layerId: Id<"replLayers"> | undefined,
): Promise<void> {
	for (let at = layerId; at !== undefined; ) {
		const layer = await ctx.db.get(at);
		if (layer === null || (await referenced(ctx, at))) return;
		const chunks = await ctx.db
			.query("replLayerChunks")
			.withIndex("by_layer", (q) => q.eq("layerId", layer._id))
			.collect();
		for (const chunk of chunks) await ctx.db.delete(chunk._id);
		await ctx.db.delete(layer._id);
		at = layer.parent;
	}
}

export const purge = internalMutation({
	args: {
		replId: v.id("repls"),
		head: v.optional(v.id("replLayers")),
		cursor: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, { replId, head, cursor }) => {
		const page = await ctx.db
			.query("replLayers")
			.withIndex("by_repl_origin", (q) => q.eq("replId", replId))
			.paginate({ numItems: PURGE_BATCH, cursor: cursor ?? null });
		for (const layer of page.page) await collect(ctx, layer._id);
		if (!page.isDone)
			await ctx.scheduler.runAfter(0, internal.repls.purge, {
				replId,
				head,
				cursor: page.continueCursor,
			});
		else await collect(ctx, head);
		return null;
	},
});
