import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
	internalMutation,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import { withDefaults } from "./lib/preferenceDefaults.js";
import { MAX_PREFERENCES_BYTES } from "./limits.js";

const encoder = new TextEncoder();

const preferences = v.object({
	font: v.optional(v.string()),
	themeUses: v.optional(v.record(v.string(), v.number())),
	metadata: v.optional(v.record(v.string(), v.boolean())),
	input: v.optional(v.record(v.string(), v.boolean())),
	sidebar: v.optional(v.array(v.string())),
	hidden: v.optional(v.array(v.string())),
	statusBar: v.optional(v.array(v.string())),
	statusBarHidden: v.optional(v.array(v.string())),
	motion: v.optional(v.string()),
	panelMotion: v.optional(v.boolean()),
	traceBesideChat: v.optional(v.boolean()),
	traceLink: v.optional(v.boolean()),
});

function stripped(row: Doc<"preferences"> | null) {
	if (row === null) return {};
	const { _id, _creationTime, userId, workspaceId, ...stored } = row;
	return stored;
}

async function workspaceRow(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
	return await ctx.db
		.query("preferences")
		.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
		.unique();
}

async function rowFromBeforeWorkspaces(ctx: QueryCtx, userId: Id<"users">) {
	return await ctx.db
		.query("preferences")
		.withIndex("by_user_workspace", (q) =>
			q.eq("userId", userId).eq("workspaceId", undefined),
		)
		.unique();
}

export async function preferencesOf(
	ctx: QueryCtx,
	userId: Id<"users">,
	workspaceId: Id<"workspaces">,
) {
	const row =
		(await workspaceRow(ctx, workspaceId)) ??
		(await rowFromBeforeWorkspaces(ctx, userId));
	return withDefaults(stripped(row));
}

export const get = query({
	args: { workspaceId: v.id("workspaces") },
	returns: preferences,
	handler: async (ctx, { workspaceId }) => {
		const { workspace } = await requireWorkspace(ctx, workspaceId);
		return await preferencesOf(ctx, workspace.ownerId, workspaceId);
	},
});

export const put = mutation({
	args: { workspaceId: v.id("workspaces"), preferences },
	returns: v.null(),
	handler: async (ctx, { workspaceId, preferences }) => {
		const { workspace } = await requireWorkspace(ctx, workspaceId);
		const existing = await workspaceRow(ctx, workspaceId);
		const base =
			existing ?? (await rowFromBeforeWorkspaces(ctx, workspace.ownerId));
		const fields = {
			...stripped(base),
			...preferences,
			userId: workspace.ownerId,
			workspaceId,
		};
		if (encoder.encode(JSON.stringify(fields)).length > MAX_PREFERENCES_BYTES) {
			throw new ConvexError({ code: "PREFERENCES_TOO_LARGE" });
		}
		if (existing !== null) {
			await ctx.db.replace(existing._id, fields);
			return null;
		}
		await ctx.db.insert("preferences", fields);
		return null;
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const row = await workspaceRow(ctx, workspaceId);
		if (row !== null) await ctx.db.delete(row._id);
		return null;
	},
});
