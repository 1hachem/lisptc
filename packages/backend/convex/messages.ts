import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { requireChat } from "./lib/auth.js";
import { clamp } from "./lib/clamp.js";
import { messageType } from "./schema.js";

const MAX_TRANSCRIPT = 200;

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
});

const incoming = v.object({
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

export const append = mutation({
	args: { chatId: v.id("chats"), messages: v.array(incoming) },
	returns: v.array(v.id("messages")),
	handler: async (ctx, { chatId, messages }) => {
		const { chat } = await requireChat(ctx, chatId);
		const last = await ctx.db
			.query("messages")
			.withIndex("by_chat_seq", (q) => q.eq("chatId", chatId))
			.order("desc")
			.first();
		let seq = last === null ? 0 : last.seq + 1;
		const ids = [];
		for (const entry of messages) {
			const clamped = clamp(entry.content, entry.kwargs);
			ids.push(
				await ctx.db.insert("messages", {
					chatId,
					workspaceId: chat.workspaceId,
					seq,
					type: entry.type,
					content: clamped.content,
					kwargs: clamped.kwargs,
					truncated: clamped.truncated ? true : undefined,
				}),
			);
			seq += 1;
		}
		await ctx.db.patch(chatId, { lastMessageAt: Date.now() });
		return ids;
	},
});

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
