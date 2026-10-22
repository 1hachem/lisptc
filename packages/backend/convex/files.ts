import { isFileName } from "@repo/shared/files";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import { intoBin, trimBinLater } from "./lib/bin.js";
import { claimed } from "./lib/claimed.js";
import {
	addedAt,
	erase,
	FILE_TABLES,
	FOLDERS,
	freeIn,
	held,
	insertInto,
	isFull,
	owned,
} from "./lib/files.js";
import { storedFile, withUrl } from "./lib/stored.js";
import { ATTACHMENT_TTL_MS, MAX_KNOWLEDGE_BYTES } from "./limits.js";
import { binnedFrom } from "./schema.js";

const PURGE_BATCH = 64;

const entry = v.object({
	name: v.string(),
	contentType: v.union(v.string(), v.null()),
	size: v.number(),
	addedAt: v.number(),
});

export const uploadUrl = mutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.string(),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		return await ctx.storage.generateUploadUrl();
	},
});

export const list = query({
	args: { workspaceId: v.id("workspaces"), folder: binnedFrom },
	returns: v.array(entry),
	handler: async (ctx, { workspaceId, folder }) => {
		await requireWorkspace(ctx, workspaceId);
		const { limit, order } = FOLDERS[folder];
		const rows = await owned(ctx, folder, workspaceId, limit);
		return rows
			.map((row) => ({
				name: row.name,
				contentType: row.contentType ?? null,
				size: row.size,
				addedAt: addedAt(row),
			}))
			.sort(order);
	},
});

export const get = query({
	args: {
		workspaceId: v.id("workspaces"),
		folder: binnedFrom,
		name: v.string(),
	},
	returns: storedFile,
	handler: async (ctx, { workspaceId, folder, name }) => {
		await requireWorkspace(ctx, workspaceId);
		return await withUrl(ctx, await held(ctx, folder, workspaceId, name));
	},
});

const addRefusal = v.union(
	v.literal("BAD_KNOWLEDGE_NAME"),
	v.literal("NAME_TAKEN"),
	v.literal("FILE_TOO_LARGE"),
	v.literal("TOO_MANY_FILES"),
);

export const add = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		folder: binnedFrom,
		name: v.string(),
		storageId: v.id("_storage"),
		contentType: v.optional(v.string()),
	},
	returns: v.union(
		v.object({ name: v.string() }),
		v.object({ refused: addRefusal }),
	),
	handler: async (
		ctx,
		{ workspaceId, folder, name, storageId, contentType },
	) => {
		await requireWorkspace(ctx, workspaceId);
		const blob = await ctx.db.system.get("_storage", storageId);
		if (blob === null) throw new ConvexError({ code: "NO_UPLOAD" });
		if (await claimed(ctx, storageId))
			throw new ConvexError({ code: "UPLOAD_CLAIMED" });
		const refused = async (
			code:
				| "BAD_KNOWLEDGE_NAME"
				| "NAME_TAKEN"
				| "FILE_TOO_LARGE"
				| "TOO_MANY_FILES",
		) => {
			await ctx.storage.delete(storageId);
			return { refused: code };
		};
		if (!isFileName(name)) return await refused("BAD_KNOWLEDGE_NAME");
		if (blob.size > MAX_KNOWLEDGE_BYTES) return await refused("FILE_TOO_LARGE");
		const stored = {
			workspaceId,
			storageId,
			contentType: blob.contentType ?? (contentType || undefined),
			size: blob.size,
		};
		const existing = await held(ctx, folder, workspaceId, name);
		if (existing !== null && FOLDERS[folder].replacesOnAdd) {
			await intoBin(ctx, existing, folder);
			await trimBinLater(ctx, workspaceId);
			await insertInto(ctx, folder, { ...stored, name });
			return { name };
		}
		if (await isFull(ctx, folder, workspaceId))
			return await refused("TOO_MANY_FILES");
		const free = await freeIn(ctx, folder, workspaceId, name);
		if (free === null) return await refused("NAME_TAKEN");
		await insertInto(ctx, folder, { ...stored, name: free });
		return { name: free };
	},
});

export const remove = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		folder: binnedFrom,
		name: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, folder, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const existing = await held(ctx, folder, workspaceId, name);
		if (existing === null) return false;
		await intoBin(ctx, existing, folder);
		await trimBinLater(ctx, workspaceId);
		return true;
	},
});

export const removeMany = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		folder: binnedFrom,
		names: v.array(v.string()),
	},
	returns: v.array(v.string()),
	handler: async (ctx, { workspaceId, folder, names }) => {
		await requireWorkspace(ctx, workspaceId);
		if (names.length > FOLDERS[folder].limit)
			throw new ConvexError({ code: "TOO_MANY_FILES" });
		const removed: string[] = [];
		for (const name of new Set(names)) {
			const existing = await held(ctx, folder, workspaceId, name);
			if (existing === null) continue;
			await intoBin(ctx, existing, folder);
			removed.push(name);
		}
		if (removed.length > 0) await trimBinLater(ctx, workspaceId);
		return removed;
	},
});

export const discard = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		folder: binnedFrom,
		name: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, folder, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const existing = await held(ctx, folder, workspaceId, name);
		if (existing === null) return false;
		await erase(ctx, existing);
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
		const attached = await held(ctx, "attachments", workspaceId, name);
		if (attached === null) return "NO_SUCH_FILE";
		if ((await held(ctx, "knowledge", workspaceId, name)) !== null)
			return "NAME_TAKEN";
		if (await isFull(ctx, "knowledge", workspaceId)) return "TOO_MANY_FILES";
		await insertInto(ctx, "knowledge", {
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
			.withIndex("by_attached", (q) =>
				q.lt("attachedAt", Date.now() - ATTACHMENT_TTL_MS),
			)
			.take(PURGE_BATCH);
		for (const row of rows) await intoBin(ctx, row, "attachments");
		for (const workspaceId of new Set(rows.map((row) => row.workspaceId)))
			await trimBinLater(ctx, workspaceId);
		if (rows.length === PURGE_BATCH)
			await ctx.scheduler.runAfter(0, internal.files.expire, {});
		return null;
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		let more = false;
		for (const table of FILE_TABLES) {
			const rows = await owned(ctx, table, workspaceId, PURGE_BATCH);
			for (const row of rows) await erase(ctx, row);
			if (rows.length === PURGE_BATCH) more = true;
		}
		if (more)
			await ctx.scheduler.runAfter(0, internal.files.purge, { workspaceId });
		return null;
	},
});
