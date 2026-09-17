import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { requireUser, requireWorkspace } from "./lib/auth.js";
import { slugify } from "./lib/slug.js";

const MAX_WORKSPACES = 64;

const PURGE_BATCH = 256;

const workspace = v.object({
	_id: v.id("workspaces"),
	_creationTime: v.number(),
	ownerId: v.id("users"),
	name: v.string(),
	slug: v.string(),
});

export const list = query({
	args: {},
	returns: v.array(workspace),
	handler: async (ctx) => {
		const user = await requireUser(ctx);
		return await ctx.db
			.query("workspaces")
			.withIndex("by_owner", (q) => q.eq("ownerId", user._id))
			.take(MAX_WORKSPACES);
	},
});

export const get = query({
	args: { workspaceId: v.id("workspaces") },
	returns: workspace,
	handler: async (ctx, { workspaceId }) =>
		(await requireWorkspace(ctx, workspaceId)).workspace,
});

export const create = mutation({
	args: { name: v.string() },
	returns: v.id("workspaces"),
	handler: async (ctx, { name }) => {
		const user = await requireUser(ctx);
		const owned = await ctx.db
			.query("workspaces")
			.withIndex("by_owner", (q) => q.eq("ownerId", user._id))
			.take(MAX_WORKSPACES);
		if (owned.length >= MAX_WORKSPACES) {
			throw new ConvexError({ code: "TOO_MANY_WORKSPACES" });
		}
		const slug = slugify(name);
		const taken = await ctx.db
			.query("workspaces")
			.withIndex("by_owner_slug", (q) =>
				q.eq("ownerId", user._id).eq("slug", slug),
			)
			.unique();
		return await ctx.db.insert("workspaces", {
			ownerId: user._id,
			name,
			slug: taken === null ? slug : `${slug}-${owned.length + 1}`,
		});
	},
});

export const rename = mutation({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.null(),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		await ctx.db.patch(workspaceId, { name });
		return null;
	},
});

export const remove = mutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.id("workspaces"),
	handler: async (ctx, { workspaceId }) => {
		const { user } = await requireWorkspace(ctx, workspaceId);
		await ctx.db.delete(workspaceId);
		await ctx.scheduler.runAfter(0, internal.workspaces.purge, { workspaceId });
		const left = await ctx.db
			.query("workspaces")
			.withIndex("by_owner", (q) => q.eq("ownerId", user._id))
			.first();
		if (left !== null) return left._id;
		const name = user.name === "" ? user.email : user.name;
		return await ctx.db.insert("workspaces", {
			ownerId: user._id,
			name,
			slug: slugify(name),
		});
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const chats = await ctx.db
			.query("chats")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(PURGE_BATCH);
		for (const chat of chats) {
			await ctx.db.delete(chat._id);
			await ctx.scheduler.runAfter(0, internal.messages.purge, {
				chatId: chat._id,
			});
		}
		if (chats.length === PURGE_BATCH) {
			await ctx.scheduler.runAfter(0, internal.workspaces.purge, {
				workspaceId,
			});
		}
		return null;
	},
});
