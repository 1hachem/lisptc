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
import { waitsOnUser } from "./lib/waiting.js";
import { MAX_SPAWN_DEPTH, STREAMING_LEASE_MS } from "./limits.js";
import { dropRepl, forkRepl } from "./repls.js";
import { chatStatus, subAgent } from "./schema.js";

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
	lastStartedAt: v.optional(v.number()),
	failure: v.optional(v.string()),
	replId: v.optional(v.id("repls")),
	parentChatId: v.optional(v.id("chats")),
	agent: v.optional(subAgent),
});

export const list = query({
	args: {
		workspaceId: v.id("workspaces"),
		search: v.optional(v.string()),
		limit: v.optional(v.number()),
		archived: v.optional(v.boolean()),
	},
	returns: v.object({ chats: v.array(chat), more: v.boolean() }),
	handler: async (ctx, { workspaceId, search, limit, archived }) => {
		await requireWorkspace(ctx, workspaceId);
		const wanted = Math.min(Math.max(1, Math.floor(limit ?? PAGE)), MAX_CHATS);
		const term = search?.trim();
		const rows = archived
			? await archivedChats(ctx, workspaceId, term, wanted + 1)
			: term
				? await ctx.db
						.query("chats")
						.withSearchIndex("search_title", (q) =>
							q
								.search("title", term)
								.eq("workspaceId", workspaceId)
								.eq("archivedAt", undefined)
								.eq("parentChatId", undefined),
						)
						.take(wanted + 1)
				: await ctx.db
						.query("chats")
						.withIndex("by_workspace_live_activity", (q) =>
							q
								.eq("workspaceId", workspaceId)
								.eq("archivedAt", undefined)
								.eq("parentChatId", undefined)
								.gte("lastMessageAt", 0),
						)
						.order("desc")
						.take(wanted + 1);
		return {
			chats: rows.slice(0, wanted),
			more: rows.length > wanted,
		};
	},
});

async function archivedChats(
	ctx: QueryCtx,
	workspaceId: Id<"workspaces">,
	term: string | undefined,
	take: number,
): Promise<Doc<"chats">[]> {
	if (term)
		return await ctx.db
			.query("chats")
			.withSearchIndex("search_title", (q) =>
				q
					.search("title", term)
					.eq("workspaceId", workspaceId)
					.eq("parentChatId", undefined),
			)
			.filter((q) => q.neq(q.field("archivedAt"), undefined))
			.take(take);
	return await ctx.db
		.query("chats")
		.withIndex("by_workspace_live_activity", (q) =>
			q.eq("workspaceId", workspaceId).gte("archivedAt", 0),
		)
		.order("desc")
		.filter((q) => q.eq(q.field("parentChatId"), undefined))
		.take(take);
}

export const get = query({
	args: { chatId: v.id("chats") },
	returns: chat,
	handler: async (ctx, { chatId }) => (await requireChat(ctx, chatId)).chat,
});

export const children = query({
	args: { chatId: v.id("chats") },
	returns: v.array(
		v.object({
			_id: v.id("chats"),
			workspaceId: v.id("workspaces"),
			title: v.string(),
			status: v.optional(chatStatus),
			lastStartedAt: v.optional(v.number()),
			failure: v.optional(v.string()),
		}),
	),
	handler: async (ctx, { chatId }) => {
		const { chat } = await requireChat(ctx, chatId);
		const rows = await ctx.db
			.query("chats")
			.withIndex("by_parent", (q) => q.eq("parentChatId", chat._id))
			.take(MAX_CHATS);
		return rows.map(
			({ _id, workspaceId, title, status, lastStartedAt, failure }) => ({
				_id,
				workspaceId,
				title,
				status,
				lastStartedAt,
				failure,
			}),
		);
	},
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

export const draft = mutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.id("chats"),
	handler: async (ctx, { workspaceId }) => {
		const { user } = await requireWorkspace(ctx, workspaceId);
		const unsent = await ctx.db
			.query("chats")
			.withIndex("by_workspace_live_activity", (q) =>
				q
					.eq("workspaceId", workspaceId)
					.eq("archivedAt", undefined)
					.eq("parentChatId", undefined)
					.eq("lastMessageAt", undefined),
			)
			.filter((q) => q.eq(q.field("userId"), user._id))
			.first();
		return (
			unsent?._id ??
			(await ctx.db.insert("chats", {
				workspaceId,
				userId: user._id,
				title: "",
			}))
		);
	},
});

export async function lineageOf(
	ctx: QueryCtx,
	chat: Doc<"chats">,
): Promise<Doc<"chats">[]> {
	const lineage = [chat];
	for (let at = chat.parentChatId; at !== undefined; ) {
		const above = await ctx.db.get(at);
		if (above === null) break;
		lineage.push(above);
		at = above.parentChatId;
	}
	return lineage;
}

export async function spawnUnder(
	ctx: MutationCtx,
	chat: Doc<"chats">,
	agent: Infer<typeof subAgent>,
): Promise<Id<"chats">> {
	if ((await lineageOf(ctx, chat)).length > MAX_SPAWN_DEPTH)
		throw new ConvexError({ code: "SPAWN_TOO_DEEP" });
	return await ctx.db.insert("chats", {
		workspaceId: chat.workspaceId,
		userId: chat.userId,
		title: agent.name,
		parentChatId: chat._id,
		agent,
	});
}

export const spawn = mutation({
	args: { chatId: v.id("chats"), agent: subAgent },
	returns: v.id("chats"),
	handler: async (ctx, { chatId, agent }) =>
		await spawnUnder(ctx, (await requireChat(ctx, chatId)).chat, agent),
});

export async function startChat(
	ctx: MutationCtx,
	chatId: Id<"chats">,
): Promise<void> {
	const since = Date.now();
	await ctx.db.patch(chatId, {
		status: "streaming",
		streamingSince: since,
		lastStartedAt: since,
		failure: undefined,
	});
	await ctx.scheduler.runAfter(STREAMING_LEASE_MS, internal.chats.expire, {
		chatId,
		since,
	});
}

export const start = mutation({
	args: { chatId: v.id("chats") },
	returns: v.null(),
	handler: async (ctx, { chatId }) => {
		await requireChat(ctx, chatId);
		await startChat(ctx, chatId);
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

export async function settleChat(
	ctx: MutationCtx,
	chatId: Id<"chats">,
	{ failure, stopped }: { failure?: string; stopped?: boolean },
): Promise<void> {
	if (failure !== undefined) {
		await ctx.db.patch(chatId, {
			status: "errored",
			streamingSince: undefined,
			failure,
		});
		return;
	}
	if (stopped) {
		await ctx.db.patch(chatId, {
			status: "stopped",
			streamingSince: undefined,
			failure: undefined,
		});
		return;
	}
	const waiting = await waitsOnUser(ctx, chatId);
	await ctx.db.patch(chatId, {
		status: waiting ? "waiting" : undefined,
		streamingSince: undefined,
		failure: undefined,
	});
}

export const settle = mutation({
	args: { chatId: v.id("chats"), failure: v.optional(v.string()) },
	returns: v.null(),
	handler: async (ctx, { chatId, failure }) => {
		await requireChat(ctx, chatId);
		await settleChat(ctx, chatId, { failure });
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

export const unarchive = mutation({
	args: { chatId: v.id("chats") },
	returns: v.null(),
	handler: async (ctx, { chatId }) => {
		await requireChat(ctx, chatId);
		await ctx.db.patch(chatId, { archivedAt: undefined });
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

function layerBefore(
	kept: Doc<"messages">[],
	upTo: Doc<"messages">,
): Id<"replLayers"> | undefined {
	const settled = upTo.type === "ai" ? kept.at(-2) : upTo;
	return settled?.layerId;
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
		const forked = await ctx.db.insert("chats", {
			workspaceId: chat.workspaceId,
			userId: user._id,
			title: `${chat.title || "untitled"} (fork)`,
			lastMessageAt: Date.now(),
		});
		const head = layerBefore(kept, upTo);
		if (head !== undefined)
			await forkRepl(ctx, { _id: forked, workspaceId: chat.workspaceId }, head);
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
				layerId: message.layerId,
			});
		}
		const views = await ctx.db
			.query("views")
			.withIndex("by_chat_view", (q) => q.eq("chatId", chatId))
			.collect();
		for (const view of views)
			await ctx.db.insert("views", {
				workspaceId: view.workspaceId,
				chatId: forked,
				viewId: view.viewId,
				node: view.node,
				rev: view.rev,
				expired: view.expired,
			});
		return forked;
	},
});

async function dropChat(ctx: MutationCtx, chat: Doc<"chats">): Promise<void> {
	const children = await ctx.db
		.query("chats")
		.withIndex("by_parent", (q) => q.eq("parentChatId", chat._id))
		.collect();
	for (const child of children) await dropChat(ctx, child);
	await ctx.db.delete(chat._id);
	await dropRepl(ctx, chat);
	await ctx.scheduler.runAfter(0, internal.messages.purge, {
		chatId: chat._id,
	});
	await ctx.scheduler.runAfter(0, internal.views.purge, {
		chatId: chat._id,
	});
	await ctx.scheduler.runAfter(0, internal.tours.purge, {
		chatId: chat._id,
	});
}

export const remove = mutation({
	args: { chatId: v.id("chats") },
	returns: v.null(),
	handler: async (ctx, { chatId }) => {
		const { chat } = await requireChat(ctx, chatId);
		await dropChat(ctx, chat);
		return null;
	},
});
