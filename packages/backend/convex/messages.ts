import { paginationOptsValidator } from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server.js";
import { requireChat, requireWorkspace } from "./lib/auth.js";
import { clamp } from "./lib/clamp.js";
import { waitsOnUser } from "./lib/waiting.js";
import { messageType } from "./schema.js";

const MAX_TRANSCRIPT = 200;

const MAX_SENT = 200;

const PURGE_BATCH = 256;

const message = v.object({
	_id: v.id("messages"),
	_creationTime: v.number(),
	chatId: v.id("chats"),
	workspaceId: v.id("workspaces"),
	seq: v.number(),
	type: messageType,
	content: v.string(),
	kwargs: v.optional(v.record(v.string(), v.any())),
	truncated: v.optional(v.boolean()),
	wireId: v.optional(v.string()),
	layerId: v.optional(v.id("replLayers")),
});

const incoming = v.object({
	id: v.optional(v.string()),
	type: messageType,
	content: v.string(),
	kwargs: v.optional(v.record(v.string(), v.any())),
});

export const list = query({
	args: { chatId: v.id("chats"), paginationOpts: paginationOptsValidator },
	returns: v.object({
		page: v.array(message),
		isDone: v.boolean(),
		continueCursor: v.string(),
		splitCursor: v.optional(v.union(v.string(), v.null())),
		pageStatus: v.optional(v.union(v.string(), v.null())),
	}),
	handler: async (ctx, { chatId, paginationOpts }) => {
		await requireChat(ctx, chatId);
		return await ctx.db
			.query("messages")
			.withIndex("by_chat_seq", (q) => q.eq("chatId", chatId))
			.paginate(paginationOpts);
	},
});

export const transcript = query({
	args: { chatId: v.id("chats") },
	returns: v.array(message),
	handler: async (ctx, { chatId }) => {
		await requireChat(ctx, chatId);
		return await ctx.db
			.query("messages")
			.withIndex("by_chat_seq", (q) => q.eq("chatId", chatId))
			.take(MAX_TRANSCRIPT);
	},
});

export const sent = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(v.string()),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const rows = await ctx.db
			.query("messages")
			.withIndex("by_workspace_type", (q) =>
				q.eq("workspaceId", workspaceId).eq("type", "human"),
			)
			.order("desc")
			.take(MAX_SENT);
		return rows.reverse().map((row) => row.content);
	},
});

async function layerFor(
	ctx: QueryCtx,
	replId: Id<"repls">,
	origin: string,
): Promise<Doc<"replLayers"> | null> {
	return await ctx.db
		.query("replLayers")
		.withIndex("by_repl_origin", (q) =>
			q.eq("replId", replId).eq("origin", origin),
		)
		.first();
}

async function layersOf(
	ctx: MutationCtx,
	chat: Doc<"chats">,
	messages: { id?: string }[],
): Promise<(Id<"replLayers"> | undefined)[]> {
	const repl = chat.replId === undefined ? null : await ctx.db.get(chat.replId);
	if (repl === null) return messages.map(() => undefined);
	const own = await Promise.all(
		messages.map((m) =>
			m.id === undefined ? null : layerFor(ctx, repl._id, m.id),
		),
	);
	const first = own.find((layer): layer is Doc<"replLayers"> => layer !== null);
	let head = first === undefined ? repl.head : first.parent;
	return own.map((layer) => {
		if (layer !== null) head = layer._id;
		return head;
	});
}

export async function appendTo(
	ctx: MutationCtx,
	chat: Doc<"chats">,
	messages: Infer<typeof incoming>[],
): Promise<Id<"messages">[]> {
	const last = await ctx.db
		.query("messages")
		.withIndex("by_chat_seq", (q) => q.eq("chatId", chat._id))
		.order("desc")
		.first();
	let seq = last === null ? 0 : last.seq + 1;
	const layers = await layersOf(ctx, chat, messages);
	const ids = [];
	for (const [at, entry] of messages.entries()) {
		const clamped = clamp(entry.content, entry.kwargs);
		ids.push(
			await ctx.db.insert("messages", {
				chatId: chat._id,
				workspaceId: chat.workspaceId,
				seq,
				type: entry.type,
				content: clamped.content,
				kwargs: clamped.kwargs,
				truncated: clamped.truncated ? true : undefined,
				wireId: entry.id,
				layerId: layers[at],
			}),
		);
		seq += 1;
	}
	await ctx.db.patch(chat._id, { lastMessageAt: Date.now() });
	return ids;
}

export const append = mutation({
	args: { chatId: v.id("chats"), messages: v.array(incoming) },
	returns: v.array(v.id("messages")),
	handler: async (ctx, { chatId, messages }) =>
		await appendTo(ctx, (await requireChat(ctx, chatId)).chat, messages),
});

export const annotate = mutation({
	args: {
		chatId: v.id("chats"),
		id: v.string(),
		kwargs: v.record(v.string(), v.any()),
	},
	returns: v.null(),
	handler: async (ctx, { chatId, id, kwargs }) => {
		const { chat } = await requireChat(ctx, chatId);
		const row = await ctx.db
			.query("messages")
			.withIndex("by_chat_wire", (q) => q.eq("chatId", chatId).eq("wireId", id))
			.first();
		if (row === null) throw new ConvexError({ code: "MESSAGE_NOT_FOUND" });
		const clamped = clamp(row.content, deepMerge(row.kwargs ?? {}, kwargs));
		await ctx.db.patch(row._id, {
			content: clamped.content,
			kwargs: clamped.kwargs,
			truncated: clamped.truncated || row.truncated ? true : undefined,
		});
		if (chat.status === "waiting" && !(await waitsOnUser(ctx, chatId)))
			await ctx.db.patch(chatId, { status: undefined });
		return null;
	},
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(
	into: Record<string, unknown>,
	from: Record<string, unknown>,
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...into };
	for (const [key, value] of Object.entries(from)) {
		const standing = merged[key];
		merged[key] =
			isPlainObject(standing) && isPlainObject(value)
				? deepMerge(standing, value)
				: value;
	}
	return merged;
}

export const purge = internalMutation({
	args: { chatId: v.id("chats") },
	returns: v.null(),
	handler: async (ctx, { chatId }) => {
		const messages = await ctx.db
			.query("messages")
			.withIndex("by_chat_seq", (q) => q.eq("chatId", chatId))
			.take(PURGE_BATCH);
		for (const message of messages) await ctx.db.delete(message._id);
		if (messages.length === PURGE_BATCH) {
			await ctx.scheduler.runAfter(0, internal.messages.purge, { chatId });
		}
		return null;
	},
});
