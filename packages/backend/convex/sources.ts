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
import { MAX_SOURCE_BYTES, MAX_SOURCES } from "./limits.js";

const PURGE_BATCH = 256;

const encoder = new TextEncoder();

const SEGMENT = /^[^/\\]+$/;

const at = {
	workspaceId: v.id("workspaces"),
	folder: v.string(),
	name: v.string(),
};

function checkPath(folder: string, name: string): void {
	if (!SEGMENT.test(folder) || !SEGMENT.test(name))
		throw new ConvexError({ code: "BAD_SOURCE_PATH" });
}

async function find(
	ctx: QueryCtx | MutationCtx,
	workspaceId: Id<"workspaces">,
	folder: string,
	name: string,
) {
	return await ctx.db
		.query("sources")
		.withIndex("by_workspace_folder_name", (q) =>
			q.eq("workspaceId", workspaceId).eq("folder", folder).eq("name", name),
		)
		.unique();
}

export async function writeSource(
	ctx: MutationCtx,
	workspaceId: Id<"workspaces">,
	folder: string,
	name: string,
	text: string,
): Promise<void> {
	checkPath(folder, name);
	if (encoder.encode(text).length > MAX_SOURCE_BYTES)
		throw new ConvexError({ code: "SOURCE_TOO_LARGE" });
	const existing = await find(ctx, workspaceId, folder, name);
	if (existing !== null) {
		await ctx.db.patch(existing._id, { text });
		return;
	}
	const held = await ctx.db
		.query("sources")
		.withIndex("by_workspace_folder_name", (q) =>
			q.eq("workspaceId", workspaceId).eq("folder", folder),
		)
		.take(MAX_SOURCES);
	if (held.length >= MAX_SOURCES)
		throw new ConvexError({ code: "TOO_MANY_SOURCES" });
	await ctx.db.insert("sources", { workspaceId, folder, name, text });
}

export const list = query({
	args: { workspaceId: v.id("workspaces"), folder: v.string() },
	returns: v.array(v.string()),
	handler: async (ctx, { workspaceId, folder }) => {
		await requireWorkspace(ctx, workspaceId);
		const rows = await ctx.db
			.query("sources")
			.withIndex("by_workspace_folder_name", (q) =>
				q.eq("workspaceId", workspaceId).eq("folder", folder),
			)
			.take(MAX_SOURCES);
		return rows.map((row) => row.name);
	},
});

export const get = query({
	args: at,
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, { workspaceId, folder, name }) => {
		await requireWorkspace(ctx, workspaceId);
		return (await find(ctx, workspaceId, folder, name))?.text ?? null;
	},
});

export const put = mutation({
	args: { ...at, text: v.string() },
	returns: v.null(),
	handler: async (ctx, { workspaceId, folder, name, text }) => {
		await requireWorkspace(ctx, workspaceId);
		await writeSource(ctx, workspaceId, folder, name, text);
		return null;
	},
});

export const remove = mutation({
	args: at,
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, folder, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const existing = await find(ctx, workspaceId, folder, name);
		if (existing === null) return false;
		await ctx.db.delete(existing._id);
		return true;
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const rows = await ctx.db
			.query("sources")
			.withIndex("by_workspace_folder_name", (q) =>
				q.eq("workspaceId", workspaceId),
			)
			.take(PURGE_BATCH);
		for (const row of rows) await ctx.db.delete(row._id);
		if (rows.length === PURGE_BATCH)
			await ctx.scheduler.runAfter(0, internal.sources.purge, { workspaceId });
		return null;
	},
});
