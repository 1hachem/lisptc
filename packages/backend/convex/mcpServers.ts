import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";
import {
	internalMutation,
	type MutationCtx,
	query,
} from "./_generated/server.js";
import { observeFact } from "./context.js";
import { requireWorkspace } from "./lib/auth.js";
import { mcpServerPhase, mcpStatePhase } from "./schema.js";

const PURGE_BATCH = 256;
const LIST_LIMIT = 256;
const RECONCILE_LIMIT = 4096;

const serverRow = v.object({
	workspaceId: v.id("workspaces"),
	server: v.string(),
	phase: v.union(mcpServerPhase, v.literal("gone")),
	reason: v.optional(v.string()),
});

const stateRow = v.object({
	workspaceId: v.id("workspaces"),
	server: v.string(),
	name: v.string(),
	path: v.string(),
	size: v.string(),
	phase: v.union(mcpStatePhase, v.literal("gone")),
	lastAttached: v.optional(v.number()),
	releasedAt: v.optional(v.number()),
});

type ServerRow = Infer<typeof serverRow>;
type StateRow = Infer<typeof stateRow>;
type StoredState = Omit<Doc<"mcpState">, "_id" | "_creationTime">;

function mergedState(
	row: StateRow,
	phase: StoredState["phase"],
	existing: StoredState | null,
): StoredState {
	return {
		...row,
		phase,
		size: row.size || existing?.size || "",
		path: row.path || existing?.path || "",
		lastAttached: row.lastAttached ?? existing?.lastAttached,
		observedAt: Date.now(),
	};
}

function sameState(a: StoredState, b: StoredState): boolean {
	return (
		a.phase === b.phase &&
		a.size === b.size &&
		a.lastAttached === b.lastAttached &&
		a.releasedAt === b.releasedAt
	);
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
		state: v.array(
			v.object({
				server: v.string(),
				name: v.string(),
				path: v.string(),
				size: v.string(),
				phase: mcpStatePhase,
				lastAttached: v.optional(v.number()),
				releasedAt: v.optional(v.number()),
			}),
		),
	}),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const servers = await ctx.db
			.query("mcpServers")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(LIST_LIMIT);
		const state = await ctx.db
			.query("mcpState")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(LIST_LIMIT);
		return {
			servers: servers.map(({ server, phase, reason, observedAt }) => ({
				server,
				phase,
				...(reason === undefined ? {} : { reason }),
				observedAt,
			})),
			state: state.map(
				({ server, name, path, size, phase, lastAttached, releasedAt }) => ({
					server,
					name,
					path,
					size,
					phase,
					...(lastAttached === undefined ? {} : { lastAttached }),
					...(releasedAt === undefined ? {} : { releasedAt }),
				}),
			),
		};
	},
});

async function putServer(
	ctx: MutationCtx,
	{ workspaceId, server, phase, reason }: ServerRow,
): Promise<void> {
	await observeFact(ctx, {
		workspaceId,
		source: "mcp",
		key: server,
		state: phase,
		...(reason === undefined ? {} : { detail: reason }),
	});
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
		observedAt: Date.now(),
	};
	if (existing === null) {
		if ((await ctx.db.get(workspaceId)) === null) return;
		await ctx.db.insert("mcpServers", next);
		return;
	}
	if (existing.phase === phase && existing.reason === reason) return;
	await ctx.db.replace(existing._id, next);
}

async function putState(ctx: MutationCtx, row: StateRow): Promise<void> {
	const { workspaceId, server, name, phase } = row;
	const existing = await ctx.db
		.query("mcpState")
		.withIndex("by_workspace_server_name", (q) =>
			q.eq("workspaceId", workspaceId).eq("server", server).eq("name", name),
		)
		.unique();
	if (phase === "gone") {
		if (existing !== null) await ctx.db.delete(existing._id);
		return;
	}
	const next = mergedState(row, phase, existing);
	if (existing === null) {
		if ((await ctx.db.get(workspaceId)) === null) return;
		await ctx.db.insert("mcpState", next);
		return;
	}
	if (sameState(existing, next)) return;
	await ctx.db.replace(existing._id, next);
}

export const observeServer = internalMutation({
	args: serverRow.fields,
	returns: v.null(),
	handler: async (ctx, row) => {
		await putServer(ctx, row);
		return null;
	},
});

export const observeState = internalMutation({
	args: stateRow.fields,
	returns: v.null(),
	handler: async (ctx, row) => {
		await putState(ctx, row);
		return null;
	},
});

export const reconcile = internalMutation({
	args: { servers: v.array(serverRow), state: v.array(stateRow) },
	returns: v.null(),
	handler: async (ctx, { servers, state }) => {
		for (const row of servers) await putServer(ctx, row);
		for (const row of state) await putState(ctx, row);
		const liveServers = new Set(
			servers.map((row) => `${row.workspaceId}\0${row.server}`),
		);
		const liveState = new Set(
			state.map((row) => `${row.workspaceId}\0${row.server}\0${row.name}`),
		);
		for (const row of await ctx.db.query("mcpServers").take(RECONCILE_LIMIT))
			if (!liveServers.has(`${row.workspaceId}\0${row.server}`))
				await putServer(ctx, {
					workspaceId: row.workspaceId,
					server: row.server,
					phase: "gone",
				});
		for (const row of await ctx.db.query("mcpState").take(RECONCILE_LIMIT))
			if (!liveState.has(`${row.workspaceId}\0${row.server}\0${row.name}`))
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
		const state = await ctx.db
			.query("mcpState")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(PURGE_BATCH);
		for (const row of [...servers, ...state]) await ctx.db.delete(row._id);
		if (servers.length === PURGE_BATCH || state.length === PURGE_BATCH)
			await ctx.scheduler.runAfter(0, internal.mcpServers.purge, {
				workspaceId,
			});
		return null;
	},
});
