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
import { requireWorkspace } from "./lib/auth.js";
import { intoBin } from "./lib/bin.js";
import { served, servedFile } from "./lib/served.js";
import {
	MAX_KNOWLEDGE,
	MAX_KNOWLEDGE_BYTES,
	MAX_KNOWLEDGE_NAME,
} from "./limits.js";

const PURGE_BATCH = 64;
const UNSAFE_NAME = /[/\\\p{Cc}]/u;

const entry = v.object({
	name: v.string(),
	contentType: v.union(v.string(), v.null()),
	size: v.number(),
});

export function isKnowledgeName(name: string): boolean {
	return (
		name.length > 0 &&
		name.length <= MAX_KNOWLEDGE_NAME &&
		name.trim() === name &&
		!name.startsWith(".") &&
		!UNSAFE_NAME.test(name)
	);
}

export async function held(
	ctx: QueryCtx | MutationCtx,
	workspaceId: Id<"workspaces">,
	name: string,
) {
	return await ctx.db
		.query("knowledge")
		.withIndex("by_workspace_name", (q) =>
			q.eq("workspaceId", workspaceId).eq("name", name),
		)
		.unique();
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
			.query("knowledge")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_KNOWLEDGE);
		return rows
			.map(({ name, contentType, size }) => ({
				name,
				contentType: contentType ?? null,
				size,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	},
});

export const get = query({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: servedFile,
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		return await served(ctx, await held(ctx, workspaceId, name));
	},
});

export const refusal = v.union(
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
	returns: v.union(v.null(), refusal),
	handler: async (ctx, { workspaceId, name, storageId, contentType }) => {
		await requireWorkspace(ctx, workspaceId);
		const blob = await ctx.db.system.get("_storage", storageId);
		if (blob === null) throw new ConvexError({ code: "NO_UPLOAD" });
		const refused = async <C extends string>(code: C) => {
			await ctx.storage.delete(storageId);
			return code;
		};
		if (!isKnowledgeName(name)) return await refused("BAD_KNOWLEDGE_NAME");
		if (blob.size > MAX_KNOWLEDGE_BYTES) return await refused("FILE_TOO_LARGE");
		const stored = {
			storageId,
			contentType: blob.contentType ?? (contentType || undefined),
			size: blob.size,
		};
		const existing = await held(ctx, workspaceId, name);
		if (existing !== null) {
			await ctx.storage.delete(existing.storageId);
			await ctx.db.patch(existing._id, stored);
			return null;
		}
		const owned = await ctx.db
			.query("knowledge")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_KNOWLEDGE);
		if (owned.length >= MAX_KNOWLEDGE) return await refused("TOO_MANY_FILES");
		await ctx.db.insert("knowledge", { workspaceId, name, ...stored });
		return null;
	},
});

export const remove = mutation({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const existing = await held(ctx, workspaceId, name);
		if (existing === null) return false;
		await intoBin(ctx, existing, "knowledge");
		return true;
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const rows = await ctx.db
			.query("knowledge")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(PURGE_BATCH);
		for (const row of rows) {
			await ctx.storage.delete(row.storageId);
			await ctx.db.delete(row._id);
		}
		if (rows.length === PURGE_BATCH) {
			await ctx.scheduler.runAfter(0, internal.knowledge.purge, {
				workspaceId,
			});
		}
		return null;
	},
});
