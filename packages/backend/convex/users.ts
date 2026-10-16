import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, query } from "./_generated/server.js";
import { requireUser } from "./lib/auth.js";
import { dropWorkspace } from "./workspaces.js";

const PURGE_BATCH = 256;

export const me = query({
	args: {},
	returns: v.object({
		_id: v.id("users"),
		_creationTime: v.number(),
		authId: v.string(),
		name: v.string(),
		email: v.string(),
		image: v.optional(v.string()),
	}),
	handler: async (ctx) => await requireUser(ctx),
});

export const purge = internalMutation({
	args: { userId: v.id("users") },
	returns: v.null(),
	handler: async (ctx, { userId }) => {
		const preferences = await ctx.db
			.query("preferences")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.unique();
		if (preferences !== null) await ctx.db.delete(preferences._id);
		const workspaces = await ctx.db
			.query("workspaces")
			.withIndex("by_owner", (q) => q.eq("ownerId", userId))
			.take(PURGE_BATCH);
		for (const workspace of workspaces) {
			await dropWorkspace(ctx, workspace._id);
		}
		if (workspaces.length === PURGE_BATCH) {
			await ctx.scheduler.runAfter(0, internal.users.purge, { userId });
		}
		return null;
	},
});
