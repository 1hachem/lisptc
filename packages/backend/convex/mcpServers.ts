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
import { mcpServerPhase } from "./schema.js";

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

type ServerRow = Infer<typeof serverRow>;

function ownerKey(row: {
	workspaceId: string;
	server: string;
	instance?: string;
}): string {
	return `${row.workspaceId}\0${row.server}\0${row.instance ?? ""}`;
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
	}),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const servers = await ctx.db
			.query("mcpServers")
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
		phase: v.union(mcpServerPhase, v.literal("gone")),
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
	icon: v.optional(v.string()),
	login: v.optional(v.boolean()),
});

const MAX_MCP_ICON_BYTES = 64 * 1024;

function iconFits(icon: string | undefined): boolean {
	if (icon === undefined) return true;
	if (icon.length > MAX_MCP_ICON_BYTES) return false;
	return icon.startsWith("https://") || icon.startsWith("data:image/");
}

export const mounts = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(mountRow),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const rows = await ctx.db
			.query("mcpMounts")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(LIST_LIMIT);
		return rows.map(({ server, conf, tools, icon, login }) => ({
			server,
			...(conf === undefined ? {} : { conf }),
			tools,
			...(icon === undefined ? {} : { icon }),
			...(login === undefined ? {} : { login }),
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
	handler: async (ctx, { workspaceId, server, conf, tools, icon, login }) => {
		await requireWorkspace(ctx, workspaceId);
		if (tools.length + (conf?.length ?? 0) > MAX_MCP_MOUNT_BYTES)
			throw new Error(
				`the tools of ${server} exceed ${MAX_MCP_MOUNT_BYTES} bytes`,
			);
		if (!iconFits(icon))
			throw new Error(`the icon of ${server} is not an https or image url`);
		const row = {
			workspaceId,
			server,
			...(conf === undefined ? {} : { conf }),
			tools,
			...(icon === undefined ? {} : { icon }),
			...(login === true ? { login } : {}),
		};
		const existing = await mountOf(ctx, workspaceId, server);
		if (existing === null) {
			await ctx.db.insert("mcpMounts", { ...row, mountedAt: Date.now() });
			return null;
		}
		if (
			existing.conf === conf &&
			existing.tools === tools &&
			existing.icon === icon &&
			(existing.login === true) === (login === true)
		)
			return null;
		await ctx.db.replace(existing._id, {
			...row,
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

export const reconcile = internalMutation({
	args: { servers: v.array(serverRow) },
	returns: v.null(),
	handler: async (ctx, { servers }) => {
		for (const row of servers) await putServer(ctx, row);
		const liveServers = new Set(servers.map(ownerKey));
		for (const row of await ctx.db.query("mcpServers").take(RECONCILE_LIMIT))
			if (!liveServers.has(ownerKey(row))) await ctx.db.delete(row._id);
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
		const mounts = await ctx.db
			.query("mcpMounts")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(PURGE_BATCH);
		for (const row of [...servers, ...mounts]) await ctx.db.delete(row._id);
		if (servers.length === PURGE_BATCH || mounts.length === PURGE_BATCH)
			await ctx.scheduler.runAfter(0, internal.mcpServers.purge, {
				workspaceId,
			});
		return null;
	},
});
