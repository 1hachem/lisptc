import { LANDING_PAGE_PATH } from "@repo/landing";
import { isFilePath } from "@repo/workspace-extension/ports";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import { MAX_FILE_BYTES, MAX_FILES } from "./limits.js";

const PURGE_BATCH = 256;
const encoder = new TextEncoder();

const VERTICAL_OWNER_FILES: readonly string[] = [LANDING_PAGE_PATH];

function checkedPath(path: string): string {
	if (!isFilePath(path)) throw new ConvexError({ code: "BAD_FILE_PATH" });
	return path;
}

function writablePath(user: Doc<"users">, path: string): string {
	checkedPath(path);
	if (VERTICAL_OWNER_FILES.includes(path) && user.verticalOwner !== true)
		throw new ConvexError({ code: "VERTICAL_OWNER_REQUIRED" });
	return path;
}

async function held(
	ctx: QueryCtx | MutationCtx,
	workspaceId: Id<"workspaces">,
	path: string,
) {
	return await ctx.db
		.query("files")
		.withIndex("by_workspace_path", (q) =>
			q.eq("workspaceId", workspaceId).eq("path", path),
		)
		.unique();
}

export const list = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(v.string()),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const files = await ctx.db
			.query("files")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_FILES);
		return files.map((file) => file.path).sort();
	},
});

export const get = query({
	args: { workspaceId: v.id("workspaces"), path: v.string() },
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, { workspaceId, path }) => {
		await requireWorkspace(ctx, workspaceId);
		return (await held(ctx, workspaceId, checkedPath(path)))?.source ?? null;
	},
});

export const put = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		path: v.string(),
		source: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, { workspaceId, path, source }) => {
		const { user } = await requireWorkspace(ctx, workspaceId);
		writablePath(user, path);
		if (encoder.encode(source).length > MAX_FILE_BYTES) {
			throw new ConvexError({ code: "FILE_TOO_LARGE" });
		}
		const existing = await held(ctx, workspaceId, path);
		if (existing !== null) {
			await ctx.db.patch(existing._id, { source });
			return null;
		}
		const owned = await ctx.db
			.query("files")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_FILES);
		if (owned.length >= MAX_FILES) {
			throw new ConvexError({ code: "TOO_MANY_FILES" });
		}
		await ctx.db.insert("files", { workspaceId, path, source });
		return null;
	},
});

export const remove = mutation({
	args: { workspaceId: v.id("workspaces"), path: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, path }) => {
		const { user } = await requireWorkspace(ctx, workspaceId);
		const existing = await held(ctx, workspaceId, writablePath(user, path));
		if (existing === null) return false;
		await ctx.db.delete(existing._id);
		return true;
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const files = await ctx.db
			.query("files")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(PURGE_BATCH);
		for (const file of files) await ctx.db.delete(file._id);
		if (files.length === PURGE_BATCH) {
			await ctx.scheduler.runAfter(0, internal.files.purge, { workspaceId });
		}
		return null;
	},
});
