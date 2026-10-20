import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { held as heldAttachment } from "./attachments.js";
import { held as heldKnowledge, isKnowledgeName } from "./knowledge.js";
import { requireWorkspace } from "./lib/auth.js";
import { heldInBin } from "./lib/bin.js";
import { freeName } from "./lib/names.js";
import {
	BIN_TTL_MS,
	MAX_ATTACHMENTS,
	MAX_BIN,
	MAX_KNOWLEDGE,
} from "./limits.js";

const EMPTY_BATCH = 64;

const from = v.union(v.literal("knowledge"), v.literal("attachments"));

export const list = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(
		v.object({
			name: v.string(),
			from,
			contentType: v.union(v.string(), v.null()),
			size: v.number(),
			binnedAt: v.number(),
		}),
	),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const rows = await ctx.db
			.query("bin")
			.withIndex("by_workspace_binned", (q) => q.eq("workspaceId", workspaceId))
			.order("desc")
			.take(MAX_BIN);
		return rows.map(({ name, from, contentType, size, binnedAt }) => ({
			name,
			from,
			contentType: contentType ?? null,
			size,
			binnedAt,
		}));
	},
});

export const get = query({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.union(
		v.object({
			name: v.string(),
			from,
			contentType: v.union(v.string(), v.null()),
			size: v.number(),
			url: v.union(v.string(), v.null()),
		}),
		v.null(),
	),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const row = await heldInBin(ctx, workspaceId, name);
		if (row === null) return null;
		return {
			name: row.name,
			from: row.from,
			contentType: row.contentType ?? null,
			size: row.size,
			url: await ctx.storage.getUrl(row.storageId),
		};
	},
});

export const restore = mutation({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.union(
		v.object({ folder: from, name: v.string() }),
		v.object({
			refused: v.union(
				v.literal("NO_SUCH_FILE"),
				v.literal("TOO_MANY_FILES"),
				v.literal("NAME_TAKEN"),
			),
		}),
	),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const row = await heldInBin(ctx, workspaceId, name);
		if (row === null) return { refused: "NO_SUCH_FILE" as const };
		const held = row.from === "knowledge" ? heldKnowledge : heldAttachment;
		const limit = row.from === "knowledge" ? MAX_KNOWLEDGE : MAX_ATTACHMENTS;
		const owned = await ctx.db
			.query(row.from)
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(limit);
		if (owned.length >= limit) return { refused: "TOO_MANY_FILES" as const };
		const free = await freeName(
			async (candidate) => (await held(ctx, workspaceId, candidate)) !== null,
			row.name,
		);
		if (free === null || !isKnowledgeName(free))
			return { refused: "NAME_TAKEN" as const };
		const stored = {
			workspaceId,
			name: free,
			storageId: row.storageId,
			contentType: row.contentType,
			size: row.size,
		};
		if (row.from === "knowledge") await ctx.db.insert("knowledge", stored);
		else
			await ctx.db.insert("attachments", { ...stored, attachedAt: Date.now() });
		await ctx.db.delete(row._id);
		return { folder: row.from, name: free };
	},
});

export const remove = mutation({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const row = await heldInBin(ctx, workspaceId, name);
		if (row === null) return false;
		await ctx.storage.delete(row.storageId);
		await ctx.db.delete(row._id);
		return true;
	},
});

export const empty = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const rows = await ctx.db
			.query("bin")
			.withIndex("by_binned", (q) => q.lt("binnedAt", Date.now() - BIN_TTL_MS))
			.take(EMPTY_BATCH);
		for (const row of rows) {
			await ctx.storage.delete(row.storageId);
			await ctx.db.delete(row._id);
		}
		if (rows.length === EMPTY_BATCH)
			await ctx.scheduler.runAfter(0, internal.bin.empty, {});
		return null;
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const rows = await ctx.db
			.query("bin")
			.withIndex("by_workspace_binned", (q) => q.eq("workspaceId", workspaceId))
			.take(EMPTY_BATCH);
		for (const row of rows) {
			await ctx.storage.delete(row.storageId);
			await ctx.db.delete(row._id);
		}
		if (rows.length === EMPTY_BATCH)
			await ctx.scheduler.runAfter(0, internal.bin.purge, { workspaceId });
		return null;
	},
});
