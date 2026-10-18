import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import { env, internalMutation, query } from "./_generated/server.js";
import { authComponent } from "./auth.js";
import { requireUser } from "./lib/auth.js";
import {
	seededVerticalOwner,
	verticalOwnerEmails,
} from "./lib/vertical-owners.js";
import { dropWorkspace, MAX_WORKSPACES } from "./workspaces.js";

export const me = query({
	args: {},
	returns: v.object({
		_id: v.id("users"),
		_creationTime: v.number(),
		authId: v.string(),
		name: v.string(),
		email: v.string(),
		image: v.optional(v.string()),
		verticalOwner: v.optional(v.boolean()),
	}),
	handler: async (ctx) => await requireUser(ctx),
});

export const setVerticalOwner = internalMutation({
	args: { email: v.string(), owner: v.boolean() },
	returns: v.id("users"),
	handler: async (ctx, { email, owner }) => {
		const user = await ctx.db
			.query("users")
			.filter((q) => q.eq(q.field("email"), email))
			.unique();
		if (user === null) throw new ConvexError({ code: "NO_SUCH_USER" });
		await ctx.db.patch(user._id, { verticalOwner: owner ? true : undefined });
		return user._id;
	},
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
			.take(MAX_WORKSPACES);
		for (const workspace of workspaces) {
			await dropWorkspace(ctx, workspace._id);
		}
		if (workspaces.length === MAX_WORKSPACES) {
			await ctx.scheduler.runAfter(0, internal.users.purge, { userId });
		}
		return null;
	},
});

export const seedVerticalOwners = internalMutation({
	args: {},
	returns: v.array(v.string()),
	handler: async (ctx) => {
		const granted: string[] = [];
		for (const email of verticalOwnerEmails(env.VERTICAL_OWNER_EMAILS)) {
			const users = await ctx.db
				.query("users")
				.filter((q) => q.eq(q.field("email"), email))
				.collect();
			for (const user of users) {
				if (user.verticalOwner === true) continue;
				const account = await authComponent.getAnyUserById(ctx, user.authId);
				if (
					account === null ||
					!seededVerticalOwner(account, env.VERTICAL_OWNER_EMAILS)
				)
					continue;
				await ctx.db.patch(user._id, { verticalOwner: true });
				granted.push(email);
			}
		}
		return granted;
	},
});
