import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	query,
} from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import { MAX_MCP_REASON_LENGTH, MCP_REPORTER_STALE_MS } from "./limits.js";
import { mcpServerPhase } from "./schema.js";

const PURGE_BATCH = 256;
const LIST_LIMIT = 256;
const RECONCILE_LIMIT = 4096;
const SWEEP_BATCH = 64;

export const OPERATOR = "operator";

const serverRow = v.object({
	workspaceId: v.id("workspaces"),
	server: v.string(),
	phase: v.union(mcpServerPhase, v.literal("gone")),
	reason: v.optional(v.string()),
});

type ServerRow = Infer<typeof serverRow>;

function ownerKey(row: { workspaceId: string; server: string }): string {
	return `${row.workspaceId}\0${row.server}`;
}
export const list = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.object({
		servers: v.array(
			v.object({
				server: v.string(),
				phase: mcpServerPhase,
				reason: v.optional(v.string()),
				observedAt: v.number(),
			}),
		),
	}),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const servers = await ctx.db
			.query("mcpServers")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(LIST_LIMIT);
		return {
			servers: servers.map(({ server, phase, reason, observedAt }) => ({
				server,
				phase,
				...(reason === undefined ? {} : { reason }),
				observedAt,
			})),
		};
	},
});

async function putServer(
	ctx: MutationCtx,
	{ workspaceId, server, phase, reason }: ServerRow,
	reporter: string,
): Promise<void> {
	const existing = await ctx.db
		.query("mcpServers")
		.withIndex("by_workspace_server", (q) =>
			q.eq("workspaceId", workspaceId).eq("server", server),
		)
		.unique();
	if (phase === "gone") {
		if (existing !== null) await ctx.db.delete(existing._id);
		return;
	}
	const next = {
		workspaceId,
		server,
		phase,
		...(reason === undefined ? {} : { reason }),
		reporter,
		observedAt: Date.now(),
	};
	if (existing === null) {
		if ((await ctx.db.get(workspaceId)) === null) return;
		await ctx.db.insert("mcpServers", next);
		return;
	}
	if (
		existing.phase === phase &&
		existing.reason === reason &&
		existing.reporter === reporter
	)
		return;
	await ctx.db.replace(existing._id, next);
}

export const observeServer = internalMutation({
	args: serverRow.fields,
	returns: v.null(),
	handler: async (ctx, row) => {
		await putServer(ctx, row, OPERATOR);
		await beat(ctx, OPERATOR);
		return null;
	},
});

const reported = v.object({
	server: v.string(),
	phase: v.union(mcpServerPhase, v.literal("gone")),
	reason: v.optional(v.string()),
});

function tailOf(reason: string | undefined): { reason?: string } {
	return reason === undefined
		? {}
		: { reason: reason.slice(-MAX_MCP_REASON_LENGTH) };
}

async function beat(
	ctx: MutationCtx,
	reporter: string,
	workspaceId?: Id<"workspaces">,
): Promise<void> {
	const existing = await ctx.db
		.query("mcpReporters")
		.withIndex("by_reporter", (q) => q.eq("reporter", reporter))
		.unique();
	if (existing === null) {
		await ctx.db.insert("mcpReporters", {
			reporter,
			...(workspaceId === undefined ? {} : { workspaceId }),
			beatAt: Date.now(),
		});
		return;
	}
	if (existing.workspaceId !== workspaceId)
		throw new ConvexError({ code: "FORBIDDEN" });
	await ctx.db.patch(existing._id, { beatAt: Date.now() });
}

function sessionReporter(reporter: string): string {
	if (reporter === OPERATOR) throw new ConvexError({ code: "FORBIDDEN" });
	return reporter;
}

export const report = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		reporter: v.string(),
		...reported.fields,
	},
	returns: v.null(),
	handler: async (ctx, { workspaceId, reporter, reason, ...row }) => {
		await requireWorkspace(ctx, workspaceId);
		const by = sessionReporter(reporter);
		await beat(ctx, by, workspaceId);
		await putServer(ctx, { workspaceId, ...row, ...tailOf(reason) }, by);
		return null;
	},
});

export const heartbeat = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		reporter: v.string(),
		servers: v.array(reported),
	},
	returns: v.null(),
	handler: async (ctx, { workspaceId, reporter, servers }) => {
		await requireWorkspace(ctx, workspaceId);
		const by = sessionReporter(reporter);
		await beat(ctx, by, workspaceId);
		for (const { reason, ...row } of servers)
			await putServer(ctx, { workspaceId, ...row, ...tailOf(reason) }, by);
		return null;
	},
});

export const sweep = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const stale = await ctx.db
			.query("mcpReporters")
			.withIndex("by_beat", (q) =>
				q.lt("beatAt", Date.now() - MCP_REPORTER_STALE_MS),
			)
			.take(SWEEP_BATCH);
		for (const quiet of stale) {
			for (const row of await ctx.db
				.query("mcpServers")
				.withIndex("by_reporter", (q) => q.eq("reporter", quiet.reporter))
				.take(RECONCILE_LIMIT))
				if (row.phase === "starting" || row.phase === "ready")
					await ctx.db.patch(row._id, {
						phase: "failed",
						reason: "its host stopped reporting.",
						observedAt: Date.now(),
					});
			await ctx.db.delete(quiet._id);
		}
		return null;
	},
});

export const reconcile = internalMutation({
	args: { servers: v.array(serverRow) },
	returns: v.null(),
	handler: async (ctx, { servers }) => {
		for (const row of servers) await putServer(ctx, row, OPERATOR);
		await beat(ctx, OPERATOR);
		const liveServers = new Set(servers.map(ownerKey));
		for (const row of await ctx.db.query("mcpServers").take(RECONCILE_LIMIT))
			if (row.reporter === OPERATOR && !liveServers.has(ownerKey(row)))
				await ctx.db.delete(row._id);
		return null;
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const servers = await ctx.db
			.query("mcpServers")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(PURGE_BATCH);
		for (const row of servers) await ctx.db.delete(row._id);
		if (servers.length === PURGE_BATCH)
			await ctx.scheduler.runAfter(0, internal.mcpServers.purge, {
				workspaceId,
			});
		return null;
	},
});
