import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { requireChat } from "./lib/auth.js";
import { MAX_VIEW_BYTES } from "./limits.js";

const PURGE_BATCH = 256;

const encoder = new TextEncoder();

export const get = query({
	args: { chatId: v.id("chats"), viewId: v.string() },
	returns: v.union(
		v.object({ node: v.any(), rev: v.number(), expired: v.boolean() }),
		v.null(),
	),
	handler: async (ctx, { chatId, viewId }) => {
		await requireChat(ctx, chatId);
		const row = await ctx.db
			.query("views")
			.withIndex("by_chat_view", (q) =>
				q.eq("chatId", chatId).eq("viewId", viewId),
			)
			.unique();
		return row === null
			? null
			: { node: row.node, rev: row.rev, expired: row.expired === true };
	},
});

export const put = mutation({
	args: { chatId: v.id("chats"), viewId: v.string(), node: v.any() },
	returns: v.null(),
	handler: async (ctx, { chatId, viewId, node }) => {
		const { chat } = await requireChat(ctx, chatId);
		if (encoder.encode(JSON.stringify(node)).length > MAX_VIEW_BYTES)
			throw new ConvexError({ code: "VIEW_TOO_LARGE" });
		const row = await ctx.db
			.query("views")
			.withIndex("by_chat_view", (q) =>
				q.eq("chatId", chatId).eq("viewId", viewId),
			)
			.unique();
		if (row === null) {
			await ctx.db.insert("views", {
				workspaceId: chat.workspaceId,
				chatId,
				viewId,
				node,
				rev: 1,
			});
			return null;
		}
		await ctx.db.patch(row._id, { node, rev: row.rev + 1, expired: undefined });
		return null;
	},
});

export const expire = mutation({
	args: { chatId: v.id("chats"), viewId: v.string() },
	returns: v.null(),
	handler: async (ctx, { chatId, viewId }) => {
		await requireChat(ctx, chatId);
		const row = await ctx.db
			.query("views")
			.withIndex("by_chat_view", (q) =>
				q.eq("chatId", chatId).eq("viewId", viewId),
			)
			.unique();
		if (row === null || row.expired === true) return null;
		await ctx.db.patch(row._id, { expired: true, rev: row.rev + 1 });
		return null;
	},
});

export const purge = internalMutation({
	args: { chatId: v.id("chats") },
	returns: v.null(),
	handler: async (ctx, { chatId }) => {
		const rows = await ctx.db
			.query("views")
			.withIndex("by_chat_view", (q) => q.eq("chatId", chatId))
			.take(PURGE_BATCH);
		for (const row of rows) await ctx.db.delete(row._id);
		if (rows.length === PURGE_BATCH)
			await ctx.scheduler.runAfter(0, internal.views.purge, { chatId });
		return null;
	},
});
