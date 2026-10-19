import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import { MAX_AGENT_BYTES, MAX_AGENTS } from "./limits.js";

const PURGE_BATCH = 256;

const encoder = new TextEncoder();

const stored = {
	name: v.string(),
	prompt: v.string(),
};

const agent = v.object({
	_id: v.id("agents"),
	_creationTime: v.number(),
	workspaceId: v.id("workspaces"),
	...stored,
});

export const list = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(agent),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		return await ctx.db
			.query("agents")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_AGENTS);
	},
});

export const put = mutation({
	args: { workspaceId: v.id("workspaces"), agent: v.object(stored) },
	returns: v.null(),
	handler: async (ctx, { workspaceId, agent }) => {
		await requireWorkspace(ctx, workspaceId);
		if (encoder.encode(agent.name + agent.prompt).length > MAX_AGENT_BYTES) {
			throw new ConvexError({ code: "AGENT_TOO_LARGE" });
		}
		const existing = await ctx.db
			.query("agents")
			.withIndex("by_workspace_name", (q) =>
				q.eq("workspaceId", workspaceId).eq("name", agent.name),
			)
			.unique();
		if (existing !== null) {
			await ctx.db.replace(existing._id, { workspaceId, ...agent });
			return null;
		}
		const owned = await ctx.db
			.query("agents")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_AGENTS);
		if (owned.length >= MAX_AGENTS) {
			throw new ConvexError({ code: "TOO_MANY_AGENTS" });
		}
		await ctx.db.insert("agents", { workspaceId, ...agent });
		return null;
	},
});

export const remove = mutation({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const existing = await ctx.db
			.query("agents")
			.withIndex("by_workspace_name", (q) =>
				q.eq("workspaceId", workspaceId).eq("name", name),
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
		const agents = await ctx.db
			.query("agents")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(PURGE_BATCH);
		for (const agent of agents) await ctx.db.delete(agent._id);
		if (agents.length === PURGE_BATCH) {
			await ctx.scheduler.runAfter(0, internal.agents.purge, { workspaceId });
		}
		return null;
	},
});
