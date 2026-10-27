import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
	internalMutation,
	internalQuery,
	type QueryCtx,
} from "./_generated/server.js";
import { lineageOf, settleChat, spawnUnder, startChat } from "./chats.js";
import {
	annotateIn,
	appendTo,
	incomingMessages,
	transcriptMessages,
	transcriptOf,
} from "./messages.js";
import { preferencesOf } from "./preferences.js";
import { openRepl } from "./repls.js";
import { modelChoice, subAgent } from "./schema.js";

async function threadChat(
	ctx: QueryCtx,
	chatId: Id<"chats">,
): Promise<Doc<"chats">> {
	const chat = await ctx.db.get(chatId);
	if (chat === null) throw new ConvexError({ code: "NOT_FOUND" });
	return chat;
}

export const record = internalQuery({
	args: { chatId: v.id("chats") },
	returns: v.object({
		workspaceId: v.id("workspaces"),
		ownerId: v.id("users"),
		parentId: v.optional(v.id("chats")),
		title: v.string(),
		model: v.optional(modelChoice),
		runsForms: v.boolean(),
		lineage: v.array(v.object({ agent: v.optional(subAgent) })),
	}),
	handler: async (ctx, { chatId }) => {
		const chat = await threadChat(ctx, chatId);
		const workspace = await ctx.db.get(chat.workspaceId);
		if (workspace === null) throw new ConvexError({ code: "NOT_FOUND" });
		const preferences = await preferencesOf(ctx, workspace.ownerId);
		return {
			workspaceId: chat.workspaceId,
			ownerId: workspace.ownerId,
			...(chat.parentChatId === undefined
				? {}
				: { parentId: chat.parentChatId }),
			title: chat.title,
			...(workspace.model === undefined ? {} : { model: workspace.model }),
			runsForms: preferences.input?.lisp !== false,
			lineage: (await lineageOf(ctx, chat)).map(({ agent }) =>
				agent === undefined ? {} : { agent },
			),
		};
	},
});

export const transcript = internalQuery({
	args: { chatId: v.id("chats") },
	returns: transcriptMessages,
	handler: async (ctx, { chatId }) =>
		await transcriptOf(ctx, (await threadChat(ctx, chatId))._id),
});

export const append = internalMutation({
	args: { chatId: v.id("chats"), messages: incomingMessages },
	returns: v.array(v.id("messages")),
	handler: async (ctx, { chatId, messages }) =>
		await appendTo(ctx, await threadChat(ctx, chatId), messages),
});

export const annotate = internalMutation({
	args: {
		chatId: v.id("chats"),
		id: v.string(),
		kwargs: v.record(v.string(), v.any()),
	},
	returns: v.null(),
	handler: async (ctx, { chatId, id, kwargs }) => {
		await annotateIn(ctx, await threadChat(ctx, chatId), id, kwargs);
		return null;
	},
});

export const start = internalMutation({
	args: { chatId: v.id("chats") },
	returns: v.null(),
	handler: async (ctx, { chatId }) => {
		await startChat(ctx, (await threadChat(ctx, chatId))._id);
		return null;
	},
});

export const settle = internalMutation({
	args: {
		chatId: v.id("chats"),
		failure: v.optional(v.string()),
		stopped: v.optional(v.boolean()),
	},
	returns: v.null(),
	handler: async (ctx, { chatId, ...ending }) => {
		await settleChat(ctx, (await threadChat(ctx, chatId))._id, ending);
		return null;
	},
});

export const repl = internalMutation({
	args: { chatId: v.id("chats") },
	returns: v.id("repls"),
	handler: async (ctx, { chatId }) =>
		await openRepl(ctx, await threadChat(ctx, chatId)),
});

export const childRepl = internalQuery({
	args: { chatId: v.id("chats"), parent: v.id("chats") },
	returns: v.union(v.id("repls"), v.null()),
	handler: async (ctx, { chatId, parent }) => {
		const chat = await threadChat(ctx, chatId);
		if (chat.parentChatId !== parent)
			throw new ConvexError({ code: "NOT_FOUND" });
		return chat.replId ?? null;
	},
});

export const spawn = internalMutation({
	args: { chatId: v.id("chats"), agent: subAgent },
	returns: v.id("chats"),
	handler: async (ctx, { chatId, agent }) =>
		await spawnUnder(ctx, await threadChat(ctx, chatId), agent),
});
