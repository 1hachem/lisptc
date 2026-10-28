import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server.js";
import { requireUser } from "./lib/auth.js";
import { DESKTOP_STALE_MS } from "./limits.js";

const SWEEP_BATCH = 128;

export const mine = query({
	args: {},
	returns: v.object({ connected: v.boolean() }),
	handler: async (ctx) => {
		const user = await requireUser(ctx);
		const row = await ctx.db
			.query("desktops")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.first();
		return { connected: row !== null };
	},
});

export const attach = internalMutation({
	args: {
		userId: v.id("users"),
		connection: v.string(),
		instance: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, { userId, connection, instance }) => {
		const previous = await ctx.db
			.query("desktops")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();
		for (const row of previous) await ctx.db.delete(row._id);
		const now = Date.now();
		await ctx.db.insert("desktops", {
			userId,
			connection,
			instance,
			connectedAt: now,
			seenAt: now,
		});
		return null;
	},
});

export const detach = internalMutation({
	args: { userId: v.id("users"), connection: v.string() },
	returns: v.null(),
	handler: async (ctx, { userId, connection }) => {
		const rows = await ctx.db
			.query("desktops")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();
		for (const row of rows)
			if (row.connection === connection) await ctx.db.delete(row._id);
		return null;
	},
});

export const heartbeat = internalMutation({
	args: { instance: v.string() },
	returns: v.null(),
	handler: async (ctx, { instance }) => {
		const rows = await ctx.db
			.query("desktops")
			.withIndex("by_instance", (q) => q.eq("instance", instance))
			.collect();
		const now = Date.now();
		for (const row of rows) await ctx.db.patch(row._id, { seenAt: now });
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
				q.lt("seenAt", Date.now() - DESKTOP_STALE_MS),
			)
			.take(SWEEP_BATCH);
		for (const row of stale) await ctx.db.delete(row._id);
		return null;
	},
});
