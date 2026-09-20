import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import { MAX_MEMORIES, MAX_MEMORY_BYTES } from "./limits.js";

const PURGE_BATCH = 256;

const encoder = new TextEncoder();

const stored = {
	key: v.string(),
	body: v.string(),
	on: v.optional(v.string()),
	links: v.array(v.object({ key: v.string(), weight: v.number() })),
	score: v.number(),
	used: v.number(),
	lastUsed: v.number(),
};

const memory = v.object({
	_id: v.id("memories"),
	_creationTime: v.number(),
	workspaceId: v.id("workspaces"),
	...stored,
});

export const list = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(memory),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		return await ctx.db
			.query("memories")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_MEMORIES);
	},
});

export const get = query({
	args: { workspaceId: v.id("workspaces"), key: v.string() },
	returns: v.union(memory, v.null()),
	handler: async (ctx, { workspaceId, key }) => {
		await requireWorkspace(ctx, workspaceId);
		return await ctx.db
			.query("memories")
			.withIndex("by_workspace_key", (q) =>
				q.eq("workspaceId", workspaceId).eq("key", key),
			)
			.unique();
	},
});

export const put = mutation({
	args: { workspaceId: v.id("workspaces"), memory: v.object(stored) },
	returns: v.null(),
	handler: async (ctx, { workspaceId, memory }) => {
		await requireWorkspace(ctx, workspaceId);
		const size = encoder.encode(memory.key + memory.body + (memory.on ?? ""));
		if (size.length > MAX_MEMORY_BYTES) {
			throw new ConvexError({ code: "MEMORY_TOO_LARGE" });
		}
		const existing = await ctx.db
			.query("memories")
			.withIndex("by_workspace_key", (q) =>
				q.eq("workspaceId", workspaceId).eq("key", memory.key),
			)
			.unique();
		if (existing !== null) {
			await ctx.db.replace(existing._id, { workspaceId, ...memory });
			return null;
		}
		const owned = await ctx.db
			.query("memories")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_MEMORIES);
		if (owned.length >= MAX_MEMORIES) {
			throw new ConvexError({ code: "TOO_MANY_MEMORIES" });
		}
		await ctx.db.insert("memories", { workspaceId, ...memory });
		return null;
	},
});

export const remove = mutation({
	args: { workspaceId: v.id("workspaces"), key: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, key }) => {
		await requireWorkspace(ctx, workspaceId);
		const existing = await ctx.db
			.query("memories")
			.withIndex("by_workspace_key", (q) =>
				q.eq("workspaceId", workspaceId).eq("key", key),
			)
			.unique();
		if (existing === null) return false;
		await ctx.db.delete(existing._id);
		return true;
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const memories = await ctx.db
			.query("memories")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(PURGE_BATCH);
		for (const memory of memories) await ctx.db.delete(memory._id);
		if (memories.length === PURGE_BATCH) {
			await ctx.scheduler.runAfter(0, internal.memories.purge, { workspaceId });
		}
		return null;
	},
});
