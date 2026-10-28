import { v } from "convex/values";
import type { Id } from "./_generated/dataModel.js";
import {
	internalMutation,
	type MutationCtx,
	type QueryCtx,
	query,
} from "./_generated/server.js";
import { requireUser } from "./lib/auth.js";
import { DESKTOP_STALE_MS } from "./limits.js";

const SWEEP_BATCH = 128;

const presence = v.object({ connected: v.boolean() });

function rowOf(
	ctx: QueryCtx | MutationCtx,
	userId: Id<"users">,
	machineId: string,
) {
	return ctx.db
		.query("desktops")
		.withIndex("by_machine", (q) =>
			q.eq("userId", userId).eq("machineId", machineId),
		)
		.unique();
}

async function connectedOf(
	ctx: QueryCtx,
	userId: Id<"users">,
): Promise<{ connected: boolean }> {
	const rows = await ctx.db
		.query("desktops")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.collect();
	return { connected: rows.some((row) => row.connected === true) };
}

export const mine = query({
	args: {},
	returns: presence,
	handler: async (ctx) => connectedOf(ctx, (await requireUser(ctx))._id),
});

export const attach = internalMutation({
	args: {
		userId: v.id("users"),
		machineId: v.string(),
		label: v.string(),
		connection: v.string(),
		instance: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, { userId, machineId, label, connection, instance }) => {
		const now = Date.now();
		const fields = {
			label,
			connection,
			instance,
			connected: true,
			connectedAt: now,
			seenAt: now,
		};
		const row = await rowOf(ctx, userId, machineId);
		if (row === null)
			await ctx.db.insert("desktops", { userId, machineId, ...fields });
		else await ctx.db.patch(row._id, fields);
		return null;
	},
});

export const detach = internalMutation({
	args: {
		userId: v.id("users"),
		machineId: v.string(),
		connection: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, { userId, machineId, connection }) => {
		const row = await rowOf(ctx, userId, machineId);
		if (row?.connection === connection && row.connected === true)
			await ctx.db.patch(row._id, { connected: false });
		return null;
	},
});

export const seen = internalMutation({
	args: {
		userId: v.id("users"),
		machineId: v.string(),
		connection: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, { userId, machineId, connection }) => {
		const row = await rowOf(ctx, userId, machineId);
		if (row?.connection === connection && row.connected === true)
			await ctx.db.patch(row._id, { seenAt: Date.now() });
		return null;
	},
});

export const sweep = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const stale = await ctx.db
			.query("desktops")
			.withIndex("by_seen", (q) =>
				q.eq("connected", true).lt("seenAt", Date.now() - DESKTOP_STALE_MS),
			)
			.take(SWEEP_BATCH);
		for (const row of stale) await ctx.db.patch(row._id, { connected: false });
		return null;
	},
});
