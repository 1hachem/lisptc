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
	ATTACHMENT_TTL_MS,
	MAX_ATTACHMENTS,
	MAX_KNOWLEDGE,
	MAX_KNOWLEDGE_BYTES,
} from "./limits.js";

const PURGE_BATCH = 64;
const MAX_RENAMES = 100;

const entry = v.object({
	name: v.string(),
	contentType: v.union(v.string(), v.null()),
	size: v.number(),
	attachedAt: v.number(),
});

async function held(
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

async function live(
	ctx: QueryCtx | MutationCtx,
	workspaceId: Id<"workspaces">,
	name: string,
) {
	const row = await held(ctx, workspaceId, name);
	return row?.binnedAt === undefined ? row : null;
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

export const list = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(entry),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const rows = await ctx.db
			.query("attachments")
			.withIndex("by_workspace_binned", (q) =>
				q.eq("workspaceId", workspaceId).eq("binnedAt", undefined),
			)
			.take(MAX_ATTACHMENTS);
		return rows
			.map(({ name, contentType, size, attachedAt }) => ({
				name,
				contentType: contentType ?? null,
				size,
				attachedAt,
			}))
			.sort((a, b) => b.attachedAt - a.attachedAt);
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
		const row = await live(ctx, workspaceId, name);
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
			.query("attachments")
			.withIndex("by_workspace_binned", (q) =>
				q.eq("workspaceId", workspaceId).eq("binnedAt", undefined),
			)
			.take(MAX_ATTACHMENTS);
		if (owned.length >= MAX_ATTACHMENTS) return await refused("TOO_MANY_FILES");
		const free = await freeName(ctx, workspaceId, name);
		if (free === null || !isKnowledgeName(free))
			return await refused("BAD_KNOWLEDGE_NAME");
		await ctx.db.insert("attachments", {
			workspaceId,
			name: free,
			storageId,
			contentType: blob.contentType ?? (contentType || undefined),
			size: blob.size,
			attachedAt: Date.now(),
		});
		return { name: free };
	},
});

export const remove = mutation({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const existing = await live(ctx, workspaceId, name);
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
		const attached = await live(ctx, workspaceId, name);
		if (attached === null) return "NO_SUCH_FILE";
		if ((await heldKnowledge(ctx, workspaceId, name)) !== null)
			return "NAME_TAKEN";
		const owned = await ctx.db
			.query("knowledge")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_KNOWLEDGE);
		if (owned.length >= MAX_KNOWLEDGE) return "TOO_MANY_FILES";
		await ctx.db.insert("knowledge", {
			workspaceId,
			name: attached.name,
			storageId: attached.storageId,
			contentType: attached.contentType,
			size: attached.size,
		});
		await ctx.db.delete(attached._id);
		return null;
	},
});

export const expire = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const rows = await ctx.db
			.query("attachments")
			.withIndex("by_binned_attached", (q) =>
				q
					.eq("binnedAt", undefined)
					.lt("attachedAt", Date.now() - ATTACHMENT_TTL_MS),
			)
			.take(PURGE_BATCH);
		const binnedAt = Date.now();
		for (const row of rows) await ctx.db.patch(row._id, { binnedAt });
		if (rows.length === PURGE_BATCH)
			await ctx.scheduler.runAfter(0, internal.attachments.expire, {});
		return null;
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const rows = await ctx.db
			.query("attachments")
			.withIndex("by_workspace_binned", (q) => q.eq("workspaceId", workspaceId))
			.take(PURGE_BATCH);
		for (const row of rows) {
			await ctx.storage.delete(row.storageId);
			await ctx.db.delete(row._id);
		}
		if (rows.length === PURGE_BATCH)
			await ctx.scheduler.runAfter(0, internal.attachments.purge, {
				workspaceId,
			});
		return null;
	},
});
