import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	query,
} from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import { MAX_MCP_MOUNT_BYTES, MAX_MCP_REASON_LENGTH } from "./limits.js";
import { mcpServerPhase, mcpStatePhase } from "./schema.js";

const PURGE_BATCH = 256;
const LIST_LIMIT = 256;
const RECONCILE_LIMIT = 4096;

const serverRow = v.object({
	workspaceId: v.id("workspaces"),
	server: v.string(),
	instance: v.optional(v.string()),
	phase: v.union(mcpServerPhase, v.literal("gone")),
	reason: v.optional(v.string()),
});

const stateRow = v.object({
	workspaceId: v.id("workspaces"),
	server: v.string(),
	instance: v.optional(v.string()),
	name: v.string(),
	path: v.string(),
	size: v.string(),
	phase: v.union(mcpStatePhase, v.literal("gone")),
	lastAttached: v.optional(v.number()),
	releasedAt: v.optional(v.number()),
});

type ServerRow = Infer<typeof serverRow>;

function ownerKey(row: {
	workspaceId: string;
	server: string;
	instance?: string;
}): string {
	return `${row.workspaceId}\0${row.server}\0${row.instance ?? ""}`;
}
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
				instance: v.optional(v.string()),
				phase: mcpServerPhase,
				reason: v.optional(v.string()),
				observedAt: v.number(),
			}),
		),
		state: v.array(
			v.object({
				server: v.string(),
				instance: v.optional(v.string()),
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
			servers: servers.map(
				({ server, instance, phase, reason, observedAt }) => ({
					server,
					...(instance === undefined ? {} : { instance }),
					phase,
					...(reason === undefined ? {} : { reason }),
					observedAt,
				}),
			),
			state: state.map(
				({
					server,
					instance,
					name,
					path,
					size,
					phase,
					lastAttached,
					releasedAt,
				}) => ({
					server,
					...(instance === undefined ? {} : { instance }),
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
	{ workspaceId, server, instance, phase, reason }: ServerRow,
): Promise<void> {
	const existing = await ctx.db
		.query("mcpServers")
		.withIndex("by_workspace_server_instance", (q) =>
			q
				.eq("workspaceId", workspaceId)
				.eq("server", server)
				.eq("instance", instance),
		)
		.unique();
	if (phase === "gone") {
		if (existing !== null) await ctx.db.delete(existing._id);
		return;
	}
	const next = {
		workspaceId,
		server,
		...(instance === undefined ? {} : { instance }),
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
	const { workspaceId, server, instance, name, phase } = row;
	const existing = await ctx.db
		.query("mcpState")
		.withIndex("by_workspace_server_instance_name", (q) =>
			q
				.eq("workspaceId", workspaceId)
				.eq("server", server)
				.eq("instance", instance)
				.eq("name", name),
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

export const report = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		server: v.string(),
		phase: mcpServerPhase,
		reason: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, { workspaceId, server, phase, reason }) => {
		await requireWorkspace(ctx, workspaceId);
		await putServer(ctx, {
			workspaceId,
			server,
			phase,
			...(reason === undefined
				? {}
				: { reason: reason.slice(-MAX_MCP_REASON_LENGTH) }),
		});
		return null;
	},
});

const mountRow = v.object({
	server: v.string(),
	conf: v.optional(v.string()),
	tools: v.string(),
});

export const mounts = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(mountRow),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const rows = await ctx.db
			.query("mcpMounts")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(LIST_LIMIT);
		return rows.map(({ server, conf, tools }) => ({
			server,
			...(conf === undefined ? {} : { conf }),
			tools,
		}));
	},
});

async function mountOf(
	ctx: MutationCtx,
	workspaceId: Doc<"mcpMounts">["workspaceId"],
	server: string,
): Promise<Doc<"mcpMounts"> | null> {
	return await ctx.db
		.query("mcpMounts")
		.withIndex("by_workspace_server", (q) =>
			q.eq("workspaceId", workspaceId).eq("server", server),
		)
		.unique();
}

export const mount = mutation({
	args: { workspaceId: v.id("workspaces"), ...mountRow.fields },
	returns: v.null(),
	handler: async (ctx, { workspaceId, server, conf, tools }) => {
		await requireWorkspace(ctx, workspaceId);
		if (tools.length + (conf?.length ?? 0) > MAX_MCP_MOUNT_BYTES)
			throw new Error(
				`the tools of ${server} exceed ${MAX_MCP_MOUNT_BYTES} bytes`,
			);
		const existing = await mountOf(ctx, workspaceId, server);
		if (existing === null) {
			await ctx.db.insert("mcpMounts", {
				workspaceId,
				server,
				...(conf === undefined ? {} : { conf }),
				tools,
				mountedAt: Date.now(),
			});
			return null;
		}
		if (existing.conf === conf && existing.tools === tools) return null;
		await ctx.db.replace(existing._id, {
			workspaceId,
			server,
			...(conf === undefined ? {} : { conf }),
			tools,
			mountedAt: existing.mountedAt,
		});
		return null;
	},
});

export const unmount = mutation({
	args: { workspaceId: v.id("workspaces"), server: v.string() },
	returns: v.null(),
	handler: async (ctx, { workspaceId, server }) => {
		await requireWorkspace(ctx, workspaceId);
		const existing = await mountOf(ctx, workspaceId, server);
		if (existing !== null) await ctx.db.delete(existing._id);
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
		const liveServers = new Set(servers.map(ownerKey));
		const liveState = new Set(
			state.map((row) => `${ownerKey(row)}\0${row.name}`),
		);
		for (const row of await ctx.db.query("mcpServers").take(RECONCILE_LIMIT))
			if (!liveServers.has(ownerKey(row))) await ctx.db.delete(row._id);
		for (const row of await ctx.db.query("mcpState").take(RECONCILE_LIMIT))
			if (!liveState.has(`${ownerKey(row)}\0${row.name}`))
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
		const mounts = await ctx.db
			.query("mcpMounts")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(PURGE_BATCH);
		for (const row of [...servers, ...state, ...mounts])
			await ctx.db.delete(row._id);
		if (
			servers.length === PURGE_BATCH ||
			state.length === PURGE_BATCH ||
			mounts.length === PURGE_BATCH
		)
			await ctx.scheduler.runAfter(0, internal.mcpServers.purge, {
				workspaceId,
			});
		return null;
	},
});
