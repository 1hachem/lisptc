import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import { MAX_PERMISSIONS_BYTES } from "./limits.js";

const encoder = new TextEncoder();

export const get = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const row = await ctx.db
			.query("permissions")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.unique();
		return row?.source ?? null;
	},
});

export const put = mutation({
	args: { workspaceId: v.id("workspaces"), source: v.string() },
	returns: v.null(),
	handler: async (ctx, { workspaceId, source }) => {
		await requireWorkspace(ctx, workspaceId);
		if (encoder.encode(source).length > MAX_PERMISSIONS_BYTES) {
			throw new ConvexError({ code: "PERMISSIONS_TOO_LARGE" });
		}
		const existing = await ctx.db
			.query("permissions")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.unique();
		if (existing !== null) {
			await ctx.db.replace(existing._id, { workspaceId, source });
			return null;
		}
		await ctx.db.insert("permissions", { workspaceId, source });
		return null;
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const row = await ctx.db
			.query("permissions")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.unique();
		if (row !== null) await ctx.db.delete(row._id);
		return null;
	},
});
