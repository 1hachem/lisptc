import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import { MAX_SECRET_BYTES, MAX_SECRETS } from "./limits.js";

const PURGE_BATCH = 256;

const SECRET_KEY_PREFIX = "REPL_";

const encoder = new TextEncoder();

const stored = {
	key: v.string(),
	value: v.string(),
	description: v.string(),
};

const secret = v.object({
	_id: v.id("secrets"),
	_creationTime: v.number(),
	workspaceId: v.id("workspaces"),
	...stored,
});

export const list = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(secret),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		return await ctx.db
			.query("secrets")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_SECRETS);
	},
});

export const put = mutation({
	args: { workspaceId: v.id("workspaces"), secret: v.object(stored) },
	returns: v.null(),
	handler: async (ctx, { workspaceId, secret }) => {
		await requireWorkspace(ctx, workspaceId);
		if (!secret.key.startsWith(SECRET_KEY_PREFIX)) {
			throw new ConvexError({ code: "SECRET_KEY_UNPREFIXED" });
		}
		const size = encoder.encode(secret.key + secret.value + secret.description);
		if (size.length > MAX_SECRET_BYTES) {
			throw new ConvexError({ code: "SECRET_TOO_LARGE" });
		}
		const existing = await ctx.db
			.query("secrets")
			.withIndex("by_workspace_key", (q) =>
				q.eq("workspaceId", workspaceId).eq("key", secret.key),
			)
			.unique();
		if (existing !== null) {
			await ctx.db.replace(existing._id, { workspaceId, ...secret });
			return null;
		}
		const owned = await ctx.db
			.query("secrets")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_SECRETS);
		if (owned.length >= MAX_SECRETS) {
			throw new ConvexError({ code: "TOO_MANY_SECRETS" });
		}
		await ctx.db.insert("secrets", { workspaceId, ...secret });
		return null;
	},
});

export const remove = mutation({
	args: { workspaceId: v.id("workspaces"), key: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, key }) => {
		await requireWorkspace(ctx, workspaceId);
		const existing = await ctx.db
			.query("secrets")
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
		const secrets = await ctx.db
			.query("secrets")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(PURGE_BATCH);
		for (const secret of secrets) await ctx.db.delete(secret._id);
		if (secrets.length === PURGE_BATCH) {
			await ctx.scheduler.runAfter(0, internal.secrets.purge, { workspaceId });
		}
		return null;
	},
});
