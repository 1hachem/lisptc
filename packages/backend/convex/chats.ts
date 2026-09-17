import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { requireChat, requireWorkspace } from "./lib/auth.js";

const MAX_CHATS = 200;

const chat = v.object({
	_id: v.id("chats"),
	_creationTime: v.number(),
	workspaceId: v.id("workspaces"),
	userId: v.id("users"),
	title: v.string(),
	lastMessageAt: v.optional(v.number()),
	archivedAt: v.optional(v.number()),
});

export const list = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(chat),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const chats = await ctx.db
			.query("chats")
			.withIndex("by_workspace_activity", (q) =>
				q.eq("workspaceId", workspaceId),
			)
			.order("desc")
			.take(MAX_CHATS);
		return chats.filter((row) => row.archivedAt === undefined);
	},
});

export const get = query({
	args: { chatId: v.id("chats") },
	returns: chat,
	handler: async (ctx, { chatId }) => (await requireChat(ctx, chatId)).chat,
});

export const create = mutation({
	args: { workspaceId: v.id("workspaces"), title: v.optional(v.string()) },
	returns: v.id("chats"),
	handler: async (ctx, { workspaceId, title }) => {
		const { user } = await requireWorkspace(ctx, workspaceId);
		return await ctx.db.insert("chats", {
			workspaceId,
			userId: user._id,
			title: title ?? "",
		});
	},
});

export const rename = mutation({
	args: { chatId: v.id("chats"), title: v.string() },
	returns: v.null(),
	handler: async (ctx, { chatId, title }) => {
		await requireChat(ctx, chatId);
		await ctx.db.patch(chatId, { title });
		return null;
	},
});

export const archive = mutation({
	args: { chatId: v.id("chats") },
	returns: v.null(),
	handler: async (ctx, { chatId }) => {
		await requireChat(ctx, chatId);
		await ctx.db.patch(chatId, { archivedAt: Date.now() });
		return null;
	},
});
