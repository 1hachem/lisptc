import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import { MAX_LAYOUT_BYTES, MAX_SPLITS } from "./limits.js";
import { panelLayout } from "./schema.js";

const encoder = new TextEncoder();

export const get = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.union(panelLayout, v.null()),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const row = await ctx.db
			.query("layouts")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.unique();
		if (row === null || !("nodes" in row.layout)) return null;
		return row.layout;
	},
});

export const put = mutation({
	args: { workspaceId: v.id("workspaces"), layout: panelLayout },
	returns: v.null(),
	handler: async (ctx, { workspaceId, layout }) => {
		await requireWorkspace(ctx, workspaceId);
		if (
			layout.nodes.some(
				(node) => node.kind === "split" && node.children.length > MAX_SPLITS,
			)
		) {
			throw new ConvexError({ code: "LAYOUT_TOO_MANY_SPLITS" });
		}
		if (encoder.encode(JSON.stringify(layout)).length > MAX_LAYOUT_BYTES) {
			throw new ConvexError({ code: "LAYOUT_TOO_LARGE" });
		}
		const existing = await ctx.db
			.query("layouts")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.unique();
		if (existing !== null) {
			await ctx.db.replace(existing._id, { workspaceId, layout });
			return null;
		}
		await ctx.db.insert("layouts", { workspaceId, layout });
		return null;
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const row = await ctx.db
			.query("layouts")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.unique();
		if (row !== null) await ctx.db.delete(row._id);
		return null;
	},
});
