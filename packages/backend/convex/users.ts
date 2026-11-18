import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, query } from "./_generated/server.js";
import { requireUser } from "./lib/auth.js";
import {
	dropWorkspace,
	MAX_WORKSPACES,
	ownedWorkspaces,
} from "./workspaces.js";

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
		const desktops = await ctx.db
			.query("desktops")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();
		for (const desktop of desktops) await ctx.db.delete(desktop._id);
		const workspaces = await ownedWorkspaces(ctx, userId);
		for (const workspace of workspaces) {
			await dropWorkspace(ctx, workspace._id);
		}
		if (workspaces.length === MAX_WORKSPACES) {
			await ctx.scheduler.runAfter(0, internal.users.purge, { userId });
		}
		return null;
	},
});
