import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { type MutationCtx, mutation, query } from "./_generated/server.js";
import { requireChat, requireWorkspace } from "./lib/auth.js";
import { waitsOnUser } from "./lib/waiting.js";
import { dropRepl, forkRepl } from "./repls.js";
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
	failure: v.optional(v.string()),
	replId: v.optional(v.id("repls")),
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
		await ctx.db.patch(chatId, { status: "streaming", failure: undefined });
		return null;
	},
});

export const settle = mutation({
	args: { chatId: v.id("chats"), failure: v.optional(v.string()) },
	returns: v.null(),
	handler: async (ctx, { chatId, failure }) => {
		await requireChat(ctx, chatId);
		if (failure !== undefined) {
			await ctx.db.patch(chatId, { status: "errored", failure });
			return null;
		}
		const waiting = await waitsOnUser(ctx, chatId);
		await ctx.db.patch(chatId, {
			status: waiting ? "waiting" : undefined,
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

async function messageOf(
	ctx: MutationCtx,
	chatId: Id<"chats">,
	messageId: string,
): Promise<Doc<"messages"> | null> {
	const byWire = await ctx.db
		.query("messages")
		.withIndex("by_chat_wire", (q) =>
			q.eq("chatId", chatId).eq("wireId", messageId),
		)
		.first();
	if (byWire !== null) return byWire;
	const id = ctx.db.normalizeId("messages", messageId);
	const stored = id === null ? null : await ctx.db.get(id);
	return stored?.chatId === chatId ? stored : null;
}

function callOf(message: Doc<"messages">): number {
	const call = message.kwargs?.call;
	return typeof call === "number" ? call : 0;
}

export const fork = mutation({
	args: { chatId: v.id("chats"), messageId: v.string() },
	returns: v.id("chats"),
	handler: async (ctx, { chatId, messageId }) => {
		const { user, chat } = await requireChat(ctx, chatId);
		const upTo = await messageOf(ctx, chatId, messageId);
		if (upTo === null) throw new ConvexError({ code: "NOT_FOUND" });
		const kept = await ctx.db
			.query("messages")
			.withIndex("by_chat_seq", (q) =>
				q.eq("chatId", chatId).lte("seq", upTo.seq),
			)
			.collect();
		const call = kept.reduce((last, m) => Math.max(last, callOf(m)), 0);
		const forked = await ctx.db.insert("chats", {
			workspaceId: chat.workspaceId,
			userId: user._id,
			title: `${chat.title || "untitled"} (fork)`,
			lastMessageAt: Date.now(),
			replId: call > 0 ? await forkRepl(ctx, chat, call) : undefined,
		});
		for (const message of kept) {
			await ctx.db.insert("messages", {
				chatId: forked,
				workspaceId: message.workspaceId,
				seq: message.seq,
				type: message.type,
				content: message.content,
				kwargs: message.kwargs,
				truncated: message.truncated,
				wireId: message.wireId,
			});
		}
		return forked;
	},
});

export const remove = mutation({
	args: { chatId: v.id("chats") },
	returns: v.null(),
	handler: async (ctx, { chatId }) => {
		const { chat } = await requireChat(ctx, chatId);
		await ctx.db.delete(chatId);
		await dropRepl(ctx, chat);
		await ctx.scheduler.runAfter(0, internal.messages.purge, { chatId });
		return null;
	},
});
