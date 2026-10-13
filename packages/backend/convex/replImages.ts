import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
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

export const record = mutation({
	args: {
		chatId: v.id("chats"),
		call: v.number(),
		format: v.number(),
		chunks: v.array(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, { chatId, call, format, chunks }) => {
		const { chat } = await requireChat(ctx, chatId);
		const bytes = chunks.reduce(
			(sum, chunk) => sum + new TextEncoder().encode(chunk).length,
			0,
		);
		if (bytes > MAX_REPL_IMAGE_BYTES)
			throw new ConvexError({ code: "TOO_LARGE", bytes });
		if (chunks.some((chunk) => chunk.length > REPL_IMAGE_CHUNK_CHARS))
			throw new ConvexError({ code: "CHUNK_TOO_LARGE" });
		const existing = await ctx.db
			.query("replImages")
			.withIndex("by_chat_call", (q) => q.eq("chatId", chatId).eq("call", call))
			.unique();
		if (existing !== null) await drop(ctx, existing._id);
		const imageId = await ctx.db.insert("replImages", {
			chatId,
			workspaceId: chat.workspaceId,
			call,
			format,
			bytes,
			chunks: chunks.length,
		});
		for (const [index, data] of chunks.entries())
			await ctx.db.insert("replImageChunks", { imageId, index, data });
		return null;
	},
});

export const latest = query({
	args: { chatId: v.id("chats") },
	returns: v.union(checkpoint, v.null()),
	handler: async (ctx, { chatId }) => {
		await requireChat(ctx, chatId);
		const image = await ctx.db
			.query("replImages")
			.withIndex("by_chat_call", (q) => q.eq("chatId", chatId))
			.order("desc")
			.first();
		if (image === null) return null;
		return {
			call: image.call,
			format: image.format,
			chunks: await chunksOf(ctx, image._id),
		};
	},
});

export const at = query({
	args: { chatId: v.id("chats"), call: v.number() },
	returns: v.union(checkpoint, v.null()),
	handler: async (ctx, { chatId, call }) => {
		await requireChat(ctx, chatId);
		const image = await ctx.db
			.query("replImages")
			.withIndex("by_chat_call", (q) => q.eq("chatId", chatId).eq("call", call))
			.unique();
		if (image === null) return null;
		return {
			call: image.call,
			format: image.format,
			chunks: await chunksOf(ctx, image._id),
		};
	},
});

export const dropAfter = mutation({
	args: { chatId: v.id("chats"), call: v.number() },
	returns: v.null(),
	handler: async (ctx, { chatId, call }) => {
		await requireChat(ctx, chatId);
		const later = await ctx.db
			.query("replImages")
			.withIndex("by_chat_call", (q) => q.eq("chatId", chatId).gt("call", call))
			.collect();
		for (const image of later) await drop(ctx, image._id);
		return null;
	},
});

export const purge = internalMutation({
	args: { chatId: v.id("chats") },
	returns: v.null(),
	handler: async (ctx, { chatId }) => {
		const images = await ctx.db
			.query("replImages")
			.withIndex("by_chat_call", (q) => q.eq("chatId", chatId))
			.take(PURGE_BATCH);
		for (const image of images) await drop(ctx, image._id);
		if (images.length === PURGE_BATCH)
			await ctx.scheduler.runAfter(0, internal.replImages.purge, { chatId });
		return null;
	},
});
