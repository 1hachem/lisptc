import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import { MAX_GRAPH_BYTES, MAX_GRAPHS } from "./limits.js";

const PURGE_BATCH = 64;

const encoder = new TextEncoder();

const graph = v.object({
	_id: v.id("graphs"),
	_creationTime: v.number(),
	workspaceId: v.id("workspaces"),
	name: v.string(),
	source: v.string(),
	updatedAt: v.number(),
});

export const list = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(graph),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const rows = await ctx.db
			.query("graphs")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_GRAPHS);
		return rows.sort((a, b) => a.name.localeCompare(b.name));
	},
});

export const get = query({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.union(graph, v.null()),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		return await ctx.db
			.query("graphs")
			.withIndex("by_workspace_name", (q) =>
				q.eq("workspaceId", workspaceId).eq("name", name),
			)
			.unique();
	},
});

export const put = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		name: v.string(),
		source: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, { workspaceId, name, source }) => {
		await requireWorkspace(ctx, workspaceId);
		if (name.trim() === "") throw new ConvexError({ code: "BAD_GRAPH_NAME" });
		if (encoder.encode(name + source).length > MAX_GRAPH_BYTES) {
			throw new ConvexError({ code: "GRAPH_TOO_LARGE" });
		}
		const existing = await ctx.db
			.query("graphs")
			.withIndex("by_workspace_name", (q) =>
				q.eq("workspaceId", workspaceId).eq("name", name),
			)
			.unique();
		const updatedAt = Date.now();
		if (existing !== null) {
			await ctx.db.replace(existing._id, {
				workspaceId,
				name,
				source,
				updatedAt,
			});
			return null;
		}
		const owned = await ctx.db
			.query("graphs")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_GRAPHS);
		if (owned.length >= MAX_GRAPHS) {
			throw new ConvexError({ code: "TOO_MANY_GRAPHS" });
		}
		await ctx.db.insert("graphs", { workspaceId, name, source, updatedAt });
		return null;
	},
});

export const remove = mutation({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const existing = await ctx.db
			.query("graphs")
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
		const graphs = await ctx.db
			.query("graphs")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(PURGE_BATCH);
		for (const graph of graphs) await ctx.db.delete(graph._id);
		if (graphs.length === PURGE_BATCH) {
			await ctx.scheduler.runAfter(0, internal.graphs.purge, { workspaceId });
		}
		return null;
	},
});
