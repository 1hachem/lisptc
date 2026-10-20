import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import { BIN_TTL_MS, MAX_ATTACHMENTS, MAX_BIN } from "./limits.js";

const EMPTY_BATCH = 64;

async function row(
	ctx: QueryCtx | MutationCtx,
	workspaceId: Id<"workspaces">,
	name: string,
) {
	return await ctx.db
		.query("attachments")
		.withIndex("by_workspace_name", (q) =>
			q.eq("workspaceId", workspaceId).eq("name", name),
		)
		.unique();
}

async function binned(
	ctx: QueryCtx | MutationCtx,
	workspaceId: Id<"workspaces">,
	name: string,
) {
	const found = await row(ctx, workspaceId, name);
	return found?.binnedAt === undefined ? null : found;
}

export const list = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(
		v.object({
			name: v.string(),
			contentType: v.union(v.string(), v.null()),
			size: v.number(),
			binnedAt: v.number(),
		}),
	),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const rows = await ctx.db
			.query("attachments")
			.withIndex("by_workspace_binned", (q) =>
				q.eq("workspaceId", workspaceId).gt("binnedAt", 0),
			)
			.order("desc")
			.take(MAX_BIN);
		return rows.map(({ name, contentType, size, binnedAt }) => ({
			name,
			contentType: contentType ?? null,
			size,
			binnedAt: binnedAt ?? 0,
		}));
	},
});

export const get = query({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.union(
		v.object({
			name: v.string(),
			contentType: v.union(v.string(), v.null()),
			size: v.number(),
			url: v.union(v.string(), v.null()),
		}),
		v.null(),
	),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const found = await binned(ctx, workspaceId, name);
		if (found === null) return null;
		return {
			name: found.name,
			contentType: found.contentType ?? null,
			size: found.size,
			url: await ctx.storage.getUrl(found.storageId),
		};
	},
});

export const put = mutation({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const found = await row(ctx, workspaceId, name);
		if (found === null || found.binnedAt !== undefined) return false;
		await ctx.db.patch(found._id, { binnedAt: Date.now() });
		return true;
	},
});

export const restore = mutation({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.union(
		v.null(),
		v.literal("NO_SUCH_FILE"),
		v.literal("TOO_MANY_FILES"),
	),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const found = await binned(ctx, workspaceId, name);
		if (found === null) return "NO_SUCH_FILE";
		const live = await ctx.db
			.query("attachments")
			.withIndex("by_workspace_binned", (q) =>
				q.eq("workspaceId", workspaceId).eq("binnedAt", undefined),
			)
			.take(MAX_ATTACHMENTS);
		if (live.length >= MAX_ATTACHMENTS) return "TOO_MANY_FILES";
		await ctx.db.patch(found._id, {
			binnedAt: undefined,
			attachedAt: Date.now(),
		});
		return null;
	},
});

export const remove = mutation({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const found = await binned(ctx, workspaceId, name);
		if (found === null) return false;
		await ctx.storage.delete(found.storageId);
		await ctx.db.delete(found._id);
		return true;
	},
});

export const empty = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const rows = await ctx.db
			.query("attachments")
			.withIndex("by_binned_attached", (q) =>
				q.gt("binnedAt", 0).lt("binnedAt", Date.now() - BIN_TTL_MS),
			)
			.take(EMPTY_BATCH);
		for (const found of rows) {
			await ctx.storage.delete(found.storageId);
			await ctx.db.delete(found._id);
		}
		if (rows.length === EMPTY_BATCH)
			await ctx.scheduler.runAfter(0, internal.bin.empty, {});
		return null;
	},
});
