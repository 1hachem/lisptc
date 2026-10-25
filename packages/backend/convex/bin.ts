import { isFileName } from "@repo/shared/files";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import { erase, freeIn, held, insertInto, isFull } from "./lib/files.js";
import { BIN_TTL_MS, MAX_BIN } from "./limits.js";
import { binnedFrom } from "./schema.js";

const EMPTY_BATCH = 64;
const TRIM_BATCH = 256;

export const list = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(
		v.object({
			name: v.string(),
			from: binnedFrom,
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
			from: binnedFrom,
			contentType: v.union(v.string(), v.null()),
			size: v.number(),
			url: v.union(v.string(), v.null()),
		}),
		v.null(),
	),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const row = await held(ctx, "bin", workspaceId, name);
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
		v.object({ folder: binnedFrom, name: v.string() }),
		v.object({
			refused: v.union(
				v.literal("NO_SUCH_FILE"),
				v.literal("TOO_MANY_FILES"),
				v.literal("NAME_TAKEN"),
				v.literal("BAD_KNOWLEDGE_NAME"),
			),
		}),
	),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const row = await held(ctx, "bin", workspaceId, name);
		if (row === null) return { refused: "NO_SUCH_FILE" as const };
		if (await isFull(ctx, row.from, workspaceId))
			return { refused: "TOO_MANY_FILES" as const };
		const free = await freeIn(ctx, row.from, workspaceId, row.name);
		if (free === null) return { refused: "NAME_TAKEN" as const };
		if (!isFileName(free)) return { refused: "BAD_KNOWLEDGE_NAME" as const };
		await insertInto(ctx, row.from, {
			workspaceId,
			name: free,
			storageId: row.storageId,
			contentType: row.contentType,
			size: row.size,
		});
		await ctx.db.delete(row._id);
		return { folder: row.from, name: free };
	},
});

export const remove = mutation({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const row = await held(ctx, "bin", workspaceId, name);
		if (row === null) return false;
		await erase(ctx, row);
		return true;
	},
});

export const removeMany = mutation({
	args: { workspaceId: v.id("workspaces"), names: v.array(v.string()) },
	returns: v.array(v.string()),
	handler: async (ctx, { workspaceId, names }) => {
		await requireWorkspace(ctx, workspaceId);
		if (names.length > MAX_BIN)
			throw new ConvexError({ code: "TOO_MANY_FILES" });
		const removed: string[] = [];
		for (const name of new Set(names)) {
			const row = await held(ctx, "bin", workspaceId, name);
			if (row === null) continue;
			await erase(ctx, row);
			removed.push(name);
		}
		return removed;
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
		for (const row of rows) await erase(ctx, row);
		if (rows.length === EMPTY_BATCH)
			await ctx.scheduler.runAfter(0, internal.bin.empty, {});
		return null;
	},
});

export const trim = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const overflow = await ctx.db
			.query("bin")
			.withIndex("by_workspace_binned", (q) => q.eq("workspaceId", workspaceId))
			.order("desc")
			.take(MAX_BIN + TRIM_BATCH);
		for (const row of overflow.slice(MAX_BIN)) await erase(ctx, row);
		if (overflow.length === MAX_BIN + TRIM_BATCH)
			await ctx.scheduler.runAfter(0, internal.bin.trim, { workspaceId });
		return null;
	},
});
