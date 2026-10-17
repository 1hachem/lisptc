import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import { MAX_README_BYTES } from "./limits.js";

const encoder = new TextEncoder();

export const get = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.string(),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const row = await ctx.db
			.query("readmes")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.unique();
		return row?.body ?? "";
	},
});

export const put = mutation({
	args: { workspaceId: v.id("workspaces"), body: v.string() },
	returns: v.null(),
	handler: async (ctx, { workspaceId, body }) => {
		await requireWorkspace(ctx, workspaceId);
		if (encoder.encode(body).length > MAX_README_BYTES) {
			throw new ConvexError({ code: "README_TOO_LARGE" });
		}
		const existing = await ctx.db
			.query("readmes")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.unique();
		if (existing !== null) {
			await ctx.db.patch(existing._id, { body });
			return null;
		}
		await ctx.db.insert("readmes", { workspaceId, body });
		return null;
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const row = await ctx.db
			.query("readmes")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.unique();
		if (row !== null) await ctx.db.delete(row._id);
		return null;
	},
});
