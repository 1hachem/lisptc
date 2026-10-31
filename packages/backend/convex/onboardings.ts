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
import { MAX_ONBOARDING_BYTES, MAX_ONBOARDINGS } from "./limits.js";
import { onboardingStatus } from "./schema.js";

const PURGE_BATCH = 64;

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const encoder = new TextEncoder();

const stored = {
	name: v.string(),
	about: v.string(),
	script: v.string(),
};

const onboarding = v.object({
	_id: v.id("onboardings"),
	_creationTime: v.number(),
	workspaceId: v.id("workspaces"),
	...stored,
	status: v.union(v.literal("new"), onboardingStatus),
});

async function named(
	ctx: QueryCtx | MutationCtx,
	workspaceId: Id<"workspaces">,
	name: string,
): Promise<Doc<"onboardings"> | null> {
	return await ctx.db
		.query("onboardings")
		.withIndex("by_workspace_name", (q) =>
			q.eq("workspaceId", workspaceId).eq("name", name),
		)
		.unique();
}

async function progressOf(
	ctx: QueryCtx | MutationCtx,
	onboardingId: Id<"onboardings">,
	userId: Id<"users">,
): Promise<Doc<"onboardingProgress"> | null> {
	return await ctx.db
		.query("onboardingProgress")
		.withIndex("by_onboarding_user", (q) =>
			q.eq("onboardingId", onboardingId).eq("userId", userId),
		)
		.unique();
}

async function withStatus(
	ctx: QueryCtx,
	row: Doc<"onboardings">,
	userId: Id<"users">,
) {
	const progress = await progressOf(ctx, row._id, userId);
	return { ...row, status: progress?.status ?? ("new" as const) };
}

async function dropOnboarding(
	ctx: MutationCtx,
	onboardingId: Id<"onboardings">,
): Promise<void> {
	const progress = await ctx.db
		.query("onboardingProgress")
		.withIndex("by_onboarding_user", (q) => q.eq("onboardingId", onboardingId))
		.collect();
	for (const row of progress) await ctx.db.delete(row._id);
	await ctx.db.delete(onboardingId);
}

export const list = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(onboarding),
	handler: async (ctx, { workspaceId }) => {
		const { user } = await requireWorkspace(ctx, workspaceId);
		const rows = await ctx.db
			.query("onboardings")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_ONBOARDINGS);
		return await Promise.all(rows.map((row) => withStatus(ctx, row, user._id)));
	},
});

export const get = query({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.union(onboarding, v.null()),
	handler: async (ctx, { workspaceId, name }) => {
		const { user } = await requireWorkspace(ctx, workspaceId);
		const row = await named(ctx, workspaceId, name);
		return row === null ? null : await withStatus(ctx, row, user._id);
	},
});

export const put = mutation({
	args: { workspaceId: v.id("workspaces"), onboarding: v.object(stored) },
	returns: v.null(),
	handler: async (ctx, { workspaceId, onboarding }) => {
		await requireWorkspace(ctx, workspaceId);
		if (!NAME.test(onboarding.name)) {
			throw new ConvexError({ code: "INVALID_ONBOARDING_NAME" });
		}
		const size = encoder.encode(
			onboarding.name + onboarding.about + onboarding.script,
		);
		if (size.length > MAX_ONBOARDING_BYTES) {
			throw new ConvexError({ code: "ONBOARDING_TOO_LARGE" });
		}
		const existing = await named(ctx, workspaceId, onboarding.name);
		if (existing !== null) {
			await ctx.db.replace(existing._id, { workspaceId, ...onboarding });
			return null;
		}
		const owned = await ctx.db
			.query("onboardings")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(MAX_ONBOARDINGS);
		if (owned.length >= MAX_ONBOARDINGS) {
			throw new ConvexError({ code: "TOO_MANY_ONBOARDINGS" });
		}
		await ctx.db.insert("onboardings", { workspaceId, ...onboarding });
		return null;
	},
});

export const mark = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		name: v.string(),
		status: onboardingStatus,
	},
	returns: v.null(),
	handler: async (ctx, { workspaceId, name, status }) => {
		const { user } = await requireWorkspace(ctx, workspaceId);
		const row = await named(ctx, workspaceId, name);
		if (row === null) throw new ConvexError({ code: "NOT_FOUND" });
		const progress = await progressOf(ctx, row._id, user._id);
		const at = Date.now();
		if (progress === null) {
			await ctx.db.insert("onboardingProgress", {
				onboardingId: row._id,
				userId: user._id,
				status,
				at,
			});
		} else {
			await ctx.db.patch(progress._id, { status, at });
		}
		return null;
	},
});

export const remove = mutation({
	args: { workspaceId: v.id("workspaces"), name: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { workspaceId, name }) => {
		await requireWorkspace(ctx, workspaceId);
		const row = await named(ctx, workspaceId, name);
		if (row === null) return false;
		await dropOnboarding(ctx, row._id);
		return true;
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const rows = await ctx.db
			.query("onboardings")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(PURGE_BATCH);
		for (const row of rows) await dropOnboarding(ctx, row._id);
		if (rows.length === PURGE_BATCH) {
			await ctx.scheduler.runAfter(0, internal.onboardings.purge, {
				workspaceId,
			});
		}
		return null;
	},
});
