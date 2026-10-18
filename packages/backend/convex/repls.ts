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
import { MAX_REPL_IMAGE_BYTES, REPL_IMAGE_CHUNK_CHARS } from "./limits.js";

const PURGE_BATCH = 64;

const checkpoint = v.object({
	call: v.number(),
	format: v.number(),
	chunks: v.array(v.string()),
});

async function chunksOf(
	ctx: QueryCtx,
	imageId: Id<"replImages">,
): Promise<string[]> {
	const rows = await ctx.db
		.query("replImageChunks")
		.withIndex("by_image", (q) => q.eq("imageId", imageId))
		.collect();
	return rows.map((row) => row.data);
}

async function drop(
	ctx: MutationCtx,
	imageId: Id<"replImages">,
): Promise<void> {
	const rows = await ctx.db
		.query("replImageChunks")
		.withIndex("by_image", (q) => q.eq("imageId", imageId))
		.collect();
	for (const row of rows) await ctx.db.delete(row._id);
	await ctx.db.delete(imageId);
}

async function imageAt(
	ctx: QueryCtx,
	replId: Id<"repls">,
	call: number,
): Promise<Doc<"replImages"> | null> {
	return await ctx.db
		.query("replImages")
		.withIndex("by_repl_call", (q) => q.eq("replId", replId).eq("call", call))
		.unique();
}

async function stored(
	ctx: QueryCtx,
	image: Doc<"replImages"> | null,
): Promise<{ call: number; format: number; chunks: string[] } | null> {
	if (image === null) return null;
	return {
		call: image.call,
		format: image.format,
		chunks: await chunksOf(ctx, image._id),
	};
}

async function openRepl(
	ctx: MutationCtx,
	chat: Doc<"chats">,
): Promise<Id<"repls">> {
	if (chat.replId !== undefined) return chat.replId;
	const replId = await ctx.db.insert("repls", {
		workspaceId: chat.workspaceId,
		call: 0,
		bytes: 0,
	});
	await ctx.db.patch(chat._id, { replId });
	return replId;
}

export async function forkRepl(
	ctx: MutationCtx,
	chat: Doc<"chats">,
	call: number,
): Promise<Id<"repls">> {
	const image =
		chat.replId === undefined ? null : await imageAt(ctx, chat.replId, call);
	if (image === null) throw new ConvexError({ code: "NO_CHECKPOINT", call });
	const replId = await ctx.db.insert("repls", {
		workspaceId: chat.workspaceId,
		call: image.call,
		bytes: image.bytes,
	});
	const imageId = await ctx.db.insert("replImages", {
		replId,
		call: image.call,
		format: image.format,
		bytes: image.bytes,
		chunks: image.chunks,
	});
	for (const [index, data] of (await chunksOf(ctx, image._id)).entries())
		await ctx.db.insert("replImageChunks", { imageId, index, data });
	return replId;
}

export async function dropRepl(
	ctx: MutationCtx,
	chat: Doc<"chats">,
): Promise<void> {
	if (chat.replId === undefined) return;
	await ctx.db.delete(chat.replId);
	await ctx.scheduler.runAfter(0, internal.repls.purge, {
		replId: chat.replId,
	});
}

export const open = mutation({
	args: { chatId: v.id("chats") },
	returns: v.id("repls"),
	handler: async (ctx, { chatId }) =>
		await openRepl(ctx, (await requireChat(ctx, chatId)).chat),
});

async function standing(
	ctx: QueryCtx,
	replId: Id<"repls">,
): Promise<Doc<"repls">> {
	const repl = await ctx.db.get(replId);
	if (repl === null) throw new ConvexError({ code: "NOT_FOUND" });
	return repl;
}

export const record = internalMutation({
	args: {
		replId: v.id("repls"),
		call: v.number(),
		format: v.number(),
		chunks: v.array(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, { replId, call, format, chunks }) => {
		const repl = await standing(ctx, replId);
		const bytes = chunks.reduce(
			(sum, chunk) => sum + new TextEncoder().encode(chunk).length,
			0,
		);
		if (bytes > MAX_REPL_IMAGE_BYTES)
			throw new ConvexError({ code: "TOO_LARGE", bytes });
		if (chunks.some((chunk) => chunk.length > REPL_IMAGE_CHUNK_CHARS))
			throw new ConvexError({ code: "CHUNK_TOO_LARGE" });
		const existing = await imageAt(ctx, replId, call);
		if (existing !== null) await drop(ctx, existing._id);
		const imageId = await ctx.db.insert("replImages", {
			replId,
			call,
			format,
			bytes,
			chunks: chunks.length,
		});
		for (const [index, data] of chunks.entries())
			await ctx.db.insert("replImageChunks", { imageId, index, data });
		await ctx.db.patch(replId, {
			call: Math.max(repl.call, call),
			bytes: call >= repl.call ? bytes : repl.bytes,
		});
		return null;
	},
});

export const latest = internalQuery({
	args: { replId: v.id("repls") },
	returns: v.union(checkpoint, v.null()),
	handler: async (ctx, { replId }) => {
		await standing(ctx, replId);
		const image = await ctx.db
			.query("replImages")
			.withIndex("by_repl_call", (q) => q.eq("replId", replId))
			.order("desc")
			.first();
		return await stored(ctx, image);
	},
});

export const at = internalQuery({
	args: { replId: v.id("repls"), call: v.number() },
	returns: v.union(checkpoint, v.null()),
	handler: async (ctx, { replId, call }) => {
		await standing(ctx, replId);
		return await stored(ctx, await imageAt(ctx, replId, call));
	},
});

export const dropAfter = internalMutation({
	args: { replId: v.id("repls"), call: v.number() },
	returns: v.null(),
	handler: async (ctx, { replId, call }) => {
		await standing(ctx, replId);
		const later = await ctx.db
			.query("replImages")
			.withIndex("by_repl_call", (q) => q.eq("replId", replId).gt("call", call))
			.collect();
		for (const image of later) await drop(ctx, image._id);
		const kept = await imageAt(ctx, replId, call);
		await ctx.db.patch(replId, {
			call: kept?.call ?? 0,
			bytes: kept?.bytes ?? 0,
		});
		return null;
	},
});

export const purge = internalMutation({
	args: { replId: v.id("repls") },
	returns: v.null(),
	handler: async (ctx, { replId }) => {
		const images = await ctx.db
			.query("replImages")
			.withIndex("by_repl_call", (q) => q.eq("replId", replId))
			.take(PURGE_BATCH);
		for (const image of images) await drop(ctx, image._id);
		if (images.length === PURGE_BATCH)
			await ctx.scheduler.runAfter(0, internal.repls.purge, { replId });
		return null;
	},
});
