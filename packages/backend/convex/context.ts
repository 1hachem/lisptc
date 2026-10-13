import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
	internalMutation,
	type MutationCtx,
	mutation,
} from "./_generated/server.js";
import { appendMessages } from "./lib/append.js";
import { requireChat } from "./lib/auth.js";
import { contextRule } from "./lib/contextRules.js";

const WATCH_LIMIT = 64;
const TELL_LIMIT = 256;
const PURGE_BATCH = 256;

const fact = v.object({
	workspaceId: v.id("workspaces"),
	source: v.string(),
	key: v.string(),
	state: v.string(),
	detail: v.optional(v.string()),
});

export type ContextFact = Infer<typeof fact>;

async function tellWatchers(
	ctx: MutationCtx,
	{ workspaceId, source, key, state, detail }: ContextFact,
): Promise<void> {
	const rule = contextRule(source);
	const watches = await ctx.db
		.query("contextWatches")
		.withIndex("by_workspace_source_key", (q) =>
			q.eq("workspaceId", workspaceId).eq("source", source).eq("key", key),
		)
		.take(TELL_LIMIT);
	for (const watch of watches) {
		if (watch.told === state) continue;
		const chat = await ctx.db.get(watch.chatId);
		if (chat === null) {
			await ctx.db.delete(watch._id);
			continue;
		}
		await ctx.db.patch(watch._id, { told: state });
		const text = rule({ key, told: watch.told, state, detail });
		if (text === undefined || chat.archivedAt !== undefined) continue;
		await appendMessages(ctx, chat, [
			{
				id: crypto.randomUUID(),
				type: "system",
				content: text,
				kwargs: { source: `context/${source}` },
			},
		]);
	}
}

export async function observeFact(
	ctx: MutationCtx,
	observed: ContextFact,
): Promise<void> {
	const { workspaceId, source, key, state, detail } = observed;
	contextRule(source);
	const existing = await ctx.db
		.query("contextFacts")
		.withIndex("by_workspace_source_key", (q) =>
			q.eq("workspaceId", workspaceId).eq("source", source).eq("key", key),
		)
		.unique();
	if (existing?.state === state && existing.detail === detail) return;
	const next = {
		workspaceId,
		source,
		key,
		state,
		...(detail === undefined ? {} : { detail }),
		observedAt: Date.now(),
	};
	if (existing === null) {
		if ((await ctx.db.get(workspaceId)) === null) return;
		await ctx.db.insert("contextFacts", next);
	} else await ctx.db.replace(existing._id, next);
	await tellWatchers(ctx, observed);
}

export const observe = internalMutation({
	args: fact.fields,
	returns: v.null(),
	handler: async (ctx, observed) => {
		await observeFact(ctx, observed);
		return null;
	},
});

export const watch = mutation({
	args: {
		chatId: v.id("chats"),
		source: v.string(),
		keys: v.array(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, { chatId, source, keys }) => {
		const { chat } = await requireChat(ctx, chatId);
		contextRule(source);
		const standing = await ctx.db
			.query("contextWatches")
			.withIndex("by_chat_source", (q) =>
				q.eq("chatId", chatId).eq("source", source),
			)
			.take(WATCH_LIMIT);
		const wanted = new Set(keys.slice(0, WATCH_LIMIT));
		for (const row of standing)
			if (!wanted.delete(row.key)) await ctx.db.delete(row._id);
		for (const key of wanted) {
			const known = await ctx.db
				.query("contextFacts")
				.withIndex("by_workspace_source_key", (q) =>
					q
						.eq("workspaceId", chat.workspaceId)
						.eq("source", source)
						.eq("key", key),
				)
				.unique();
			await ctx.db.insert("contextWatches", {
				workspaceId: chat.workspaceId,
				chatId,
				source,
				key,
				...(known === null ? {} : { told: known.state }),
			});
		}
		return null;
	},
});

export async function forgetChat(
	ctx: MutationCtx,
	chatId: Id<"chats">,
): Promise<void> {
	for (const row of await ctx.db
		.query("contextWatches")
		.withIndex("by_chat_source", (q) => q.eq("chatId", chatId))
		.take(PURGE_BATCH))
		await ctx.db.delete(row._id);
}

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const facts = await ctx.db
			.query("contextFacts")
			.withIndex("by_workspace_source_key", (q) =>
				q.eq("workspaceId", workspaceId),
			)
			.take(PURGE_BATCH);
		const watches = await ctx.db
			.query("contextWatches")
			.withIndex("by_workspace_source_key", (q) =>
				q.eq("workspaceId", workspaceId),
			)
			.take(PURGE_BATCH);
		for (const row of [...facts, ...watches]) await ctx.db.delete(row._id);
		if (facts.length === PURGE_BATCH || watches.length === PURGE_BATCH)
			await ctx.scheduler.runAfter(0, internal.context.purge, { workspaceId });
		return null;
	},
});
