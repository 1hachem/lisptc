import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { requireChat, requireWorkspace } from "./lib/auth.js";
import { waitsOnUser } from "./lib/waiting.js";
import { STREAMING_LEASE_MS } from "./limits.js";
import { chatStatus } from "./schema.js";

const MAX_CHATS = 200;
const PAGE = 20;

const chat = v.object({
	_id: v.id("chats"),
	_creationTime: v.number(),
	workspaceId: v.id("workspaces"),
	userId: v.id("users"),
	title: v.string(),
	lastMessageAt: v.optional(v.number()),
	archivedAt: v.optional(v.number()),
	status: v.optional(chatStatus),
	streamingSince: v.optional(v.number()),
	failure: v.optional(v.string()),
});

export const list = query({
	args: {
		workspaceId: v.id("workspaces"),
		search: v.optional(v.string()),
		limit: v.optional(v.number()),
	},
	returns: v.object({ chats: v.array(chat), more: v.boolean() }),
	handler: async (ctx, { workspaceId, search, limit }) => {
		await requireWorkspace(ctx, workspaceId);
		const wanted = Math.min(Math.max(1, Math.floor(limit ?? PAGE)), MAX_CHATS);
		const term = search?.trim();
		const rows = term
			? await ctx.db
					.query("chats")
					.withSearchIndex("search_title", (q) =>
						q
							.search("title", term)
							.eq("workspaceId", workspaceId)
							.eq("archivedAt", undefined),
					)
					.take(wanted + 1)
			: await ctx.db
					.query("chats")
					.withIndex("by_workspace_live_activity", (q) =>
						q.eq("workspaceId", workspaceId).eq("archivedAt", undefined),
					)
					.order("desc")
					.take(wanted + 1);
		return {
			chats: rows.slice(0, wanted),
			more: rows.length > wanted,
		};
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
			lastMessageAt: Date.now(),
		});
	},
});

export const start = mutation({
	args: { chatId: v.id("chats") },
	returns: v.null(),
	handler: async (ctx, { chatId }) => {
		await requireChat(ctx, chatId);
		const since = Date.now();
		await ctx.db.patch(chatId, {
			status: "streaming",
			streamingSince: since,
			failure: undefined,
		});
		await ctx.scheduler.runAfter(STREAMING_LEASE_MS, internal.chats.expire, {
			chatId,
			since,
		});
		return null;
	},
});

export const expire = internalMutation({
	args: { chatId: v.id("chats"), since: v.number() },
	returns: v.null(),
	handler: async (ctx, { chatId, since }) => {
		const chat = await ctx.db.get(chatId);
		if (chat?.status !== "streaming" || chat.streamingSince !== since)
			return null;
		await ctx.db.patch(chatId, {
			status: "errored",
			streamingSince: undefined,
			failure: "the turn stopped answering",
		});
		return null;
	},
});

export const settle = mutation({
	args: { chatId: v.id("chats"), failure: v.optional(v.string()) },
	returns: v.null(),
	handler: async (ctx, { chatId, failure }) => {
		await requireChat(ctx, chatId);
		if (failure !== undefined) {
			await ctx.db.patch(chatId, {
				status: "errored",
				streamingSince: undefined,
				failure,
			});
			return null;
		}
		const waiting = await waitsOnUser(ctx, chatId);
		await ctx.db.patch(chatId, {
			status: waiting ? "waiting" : undefined,
			streamingSince: undefined,
			failure: undefined,
		});
		return null;
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

export const remove = mutation({
	args: { chatId: v.id("chats") },
	returns: v.null(),
	handler: async (ctx, { chatId }) => {
		await requireChat(ctx, chatId);
		await ctx.db.delete(chatId);
		await ctx.scheduler.runAfter(0, internal.messages.purge, { chatId });
		return null;
	},
});
