import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import { MAX_OAUTH_RECORD_BYTES, MAX_OAUTH_RECORDS } from "./limits.js";

const PURGE_BATCH = 256;

const encoder = new TextEncoder();

export const get = query({
	args: { workspaceId: v.id("workspaces"), serverKey: v.string() },
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, { workspaceId, serverKey }) => {
		await requireWorkspace(ctx, workspaceId);
		const existing = await ctx.db
			.query("oauthRecords")
			.withIndex("by_workspace_server", (q) =>
				q.eq("workspaceId", workspaceId).eq("serverKey", serverKey),
			)
			.unique();
		return existing === null ? null : existing.record;
	},
});

export const put = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		serverKey: v.string(),
		record: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, { workspaceId, serverKey, record }) => {
		await requireWorkspace(ctx, workspaceId);
		const size = encoder.encode(serverKey + record);
		if (size.length > MAX_OAUTH_RECORD_BYTES) {
			throw new ConvexError({ code: "OAUTH_RECORD_TOO_LARGE" });
		}
		const existing = await ctx.db
			.query("oauthRecords")
			.withIndex("by_workspace_server", (q) =>
				q.eq("workspaceId", workspaceId).eq("serverKey", serverKey),
			)
			.unique();
		if (existing !== null) {
			await ctx.db.replace(existing._id, { workspaceId, serverKey, record });
			return null;
		}
		const owned = await ctx.db
			.query("oauthRecords")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_OAUTH_RECORDS);
		if (owned.length >= MAX_OAUTH_RECORDS) {
			throw new ConvexError({ code: "TOO_MANY_OAUTH_RECORDS" });
		}
		await ctx.db.insert("oauthRecords", { workspaceId, serverKey, record });
		return null;
	},
});

export const remove = mutation({
	args: { workspaceId: v.id("workspaces"), serverKey: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, serverKey }) => {
		await requireWorkspace(ctx, workspaceId);
		const existing = await ctx.db
			.query("oauthRecords")
			.withIndex("by_workspace_server", (q) =>
				q.eq("workspaceId", workspaceId).eq("serverKey", serverKey),
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
		const records = await ctx.db
			.query("oauthRecords")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(PURGE_BATCH);
		for (const record of records) await ctx.db.delete(record._id);
		if (records.length === PURGE_BATCH) {
			await ctx.scheduler.runAfter(0, internal.oauth.purge, { workspaceId });
		}
		return null;
	},
});
