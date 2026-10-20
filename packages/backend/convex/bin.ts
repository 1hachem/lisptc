import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server.js";
import { held as heldKnowledge, isKnowledgeName } from "./knowledge.js";
import { requireWorkspace } from "./lib/auth.js";
import {
	BIN_TTL_MS,
	MAX_BIN,
	MAX_KNOWLEDGE,
	MAX_KNOWLEDGE_BYTES,
} from "./limits.js";

const PURGE_BATCH = 64;
const MAX_RENAMES = 100;

const entry = v.object({
	name: v.string(),
	contentType: v.union(v.string(), v.null()),
	size: v.number(),
	binnedAt: v.number(),
});

async function held(
	ctx: QueryCtx | MutationCtx,
	workspaceId: Id<"workspaces">,
	name: string,
) {
	return await ctx.db
		.query("bin")
		.withIndex("by_workspace_name", (q) =>
			q.eq("workspaceId", workspaceId).eq("name", name),
		)
		.unique();
}

function numbered(name: string, n: number): string {
	const dot = name.lastIndexOf(".");
	return dot <= 0
		? `${name} (${n})`
		: `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
}

async function freeName(
	ctx: MutationCtx,
	workspaceId: Id<"workspaces">,
	name: string,
): Promise<string | null> {
	if ((await held(ctx, workspaceId, name)) === null) return name;
	for (let n = 2; n <= MAX_RENAMES; n++) {
		const candidate = numbered(name, n);
		if ((await held(ctx, workspaceId, candidate)) === null) return candidate;
	}
	return null;
}

export const uploadUrl = mutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.string(),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		return await ctx.storage.generateUploadUrl();
	},
});

export const list = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(entry),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const rows = await ctx.db
			.query("bin")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_BIN);
		return rows
			.map(({ name, contentType, size, binnedAt }) => ({
				name,
				contentType: contentType ?? null,
				size,
				binnedAt,
			}))
			.sort((a, b) => b.binnedAt - a.binnedAt);
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
		const row = await held(ctx, workspaceId, name);
		if (row === null) return null;
		return {
			name: row.name,
			contentType: row.contentType ?? null,
			size: row.size,
			url: await ctx.storage.getUrl(row.storageId),
		};
	},
});

const addRefusal = v.union(
	v.literal("BAD_KNOWLEDGE_NAME"),
	v.literal("FILE_TOO_LARGE"),
	v.literal("TOO_MANY_FILES"),
);

export const add = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		name: v.string(),
		storageId: v.id("_storage"),
		contentType: v.optional(v.string()),
	},
	returns: v.union(
		v.object({ name: v.string() }),
		v.object({ refused: addRefusal }),
	),
	handler: async (ctx, { workspaceId, name, storageId, contentType }) => {
		await requireWorkspace(ctx, workspaceId);
		const blob = await ctx.db.system.get("_storage", storageId);
		if (blob === null) throw new ConvexError({ code: "NO_UPLOAD" });
		const refused = async (
			code: "BAD_KNOWLEDGE_NAME" | "FILE_TOO_LARGE" | "TOO_MANY_FILES",
		) => {
			await ctx.storage.delete(storageId);
			return { refused: code };
		};
		if (!isKnowledgeName(name)) return await refused("BAD_KNOWLEDGE_NAME");
		if (blob.size > MAX_KNOWLEDGE_BYTES) return await refused("FILE_TOO_LARGE");
		const owned = await ctx.db
			.query("bin")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_BIN);
		if (owned.length >= MAX_BIN) return await refused("TOO_MANY_FILES");
		const free = await freeName(ctx, workspaceId, name);
		if (free === null || !isKnowledgeName(free))
			return await refused("BAD_KNOWLEDGE_NAME");
		await ctx.db.insert("bin", {
			workspaceId,
			name: free,
			storageId,
			contentType: blob.contentType ?? (contentType || undefined),
			size: blob.size,
			binnedAt: Date.now(),
		});
		return { name: free };
	},
});

export const remove = mutation({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const existing = await held(ctx, workspaceId, name);
		if (existing === null) return false;
		await ctx.storage.delete(existing.storageId);
		await ctx.db.delete(existing._id);
		return true;
	},
});

export const keep = mutation({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.union(
		v.null(),
		v.literal("NO_SUCH_FILE"),
		v.literal("NAME_TAKEN"),
		v.literal("TOO_MANY_FILES"),
	),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const binned = await held(ctx, workspaceId, name);
		if (binned === null) return "NO_SUCH_FILE";
		if ((await heldKnowledge(ctx, workspaceId, name)) !== null)
			return "NAME_TAKEN";
		const owned = await ctx.db
			.query("knowledge")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_KNOWLEDGE);
		if (owned.length >= MAX_KNOWLEDGE) return "TOO_MANY_FILES";
		await ctx.db.insert("knowledge", {
			workspaceId,
			name: binned.name,
			storageId: binned.storageId,
			contentType: binned.contentType,
			size: binned.size,
		});
		await ctx.db.delete(binned._id);
		return null;
	},
});

export const expire = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const rows = await ctx.db
			.query("bin")
			.withIndex("by_binned", (q) => q.lt("binnedAt", Date.now() - BIN_TTL_MS))
			.take(PURGE_BATCH);
		for (const row of rows) {
			await ctx.storage.delete(row.storageId);
			await ctx.db.delete(row._id);
		}
		if (rows.length === PURGE_BATCH)
			await ctx.scheduler.runAfter(0, internal.bin.expire, {});
		return null;
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const rows = await ctx.db
			.query("bin")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(PURGE_BATCH);
		for (const row of rows) {
			await ctx.storage.delete(row.storageId);
			await ctx.db.delete(row._id);
		}
		if (rows.length === PURGE_BATCH)
			await ctx.scheduler.runAfter(0, internal.bin.purge, { workspaceId });
		return null;
	},
});
