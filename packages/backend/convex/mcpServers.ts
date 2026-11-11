import { ConvexError, type Infer, v } from "convex/values";
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
import {
	MAX_MCP_MOUNT_BYTES,
	MAX_MCP_REASON_LENGTH,
	MCP_REPORTER_STALE_MS,
} from "./limits.js";
import { mcpServerPhase } from "./schema.js";

const PURGE_BATCH = 256;
const LIST_LIMIT = 256;
const RECONCILE_LIMIT = 4096;
const SWEEP_BATCH = 64;

export const OPERATOR = "operator";

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
				chatTitle: v.optional(v.string()),
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
			servers: await Promise.all(
				servers.map(async ({ server, instance, phase, reason, observedAt }) => {
					const chatTitle =
						instance === undefined
							? undefined
							: await titleOfChat(ctx, instance);
					return {
						server,
						...(instance === undefined ? {} : { instance }),
						...(chatTitle === undefined ? {} : { chatTitle }),
						phase,
						...(reason === undefined ? {} : { reason }),
						observedAt,
					};
				}),
			),
		};
	},
});

async function titleOfChat(
	ctx: QueryCtx,
	instance: string,
): Promise<string | undefined> {
	const chatId = ctx.db.normalizeId("chats", instance);
	if (chatId === null) return undefined;
	return (await ctx.db.get(chatId))?.title;
}

async function heldByChat(
	ctx: MutationCtx,
	workspaceId: Id<"workspaces">,
	instance: string,
): Promise<boolean> {
	const chatId = ctx.db.normalizeId("chats", instance);
	if (chatId === null) return false;
	return (await ctx.db.get(chatId))?.workspaceId === workspaceId;
}

async function putServer(
	ctx: MutationCtx,
	{ workspaceId, server, instance, phase, reason }: ServerRow,
	reporter: string,
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
	if (
		phase === "gone" ||
		(instance !== undefined && !(await heldByChat(ctx, workspaceId, instance)))
	) {
		if (existing !== null) await ctx.db.delete(existing._id);
		return;
	}
	const next = {
		workspaceId,
		server,
		...(instance === undefined ? {} : { instance }),
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
	instance: v.optional(v.string()),
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

const MAX_MCP_ICON_BYTES = 64 * 1024;

const MAX_MCP_DESCRIPTION_LENGTH = 4096;

const catalogRow = v.object({
	server: v.string(),
	description: v.optional(v.string()),
	icon: v.optional(v.string()),
	login: v.optional(v.boolean()),
	tools: v.string(),
});

function iconFits(icon: string | undefined): boolean {
	if (icon === undefined) return true;
	if (icon.length > MAX_MCP_ICON_BYTES) return false;
	return icon.startsWith("https://") || icon.startsWith("data:image/");
}

async function catalogOf(
	ctx: QueryCtx,
	workspaceId: Id<"workspaces">,
	server: string,
): Promise<Doc<"mcpCatalog"> | null> {
	return await ctx.db
		.query("mcpCatalog")
		.withIndex("by_workspace_server", (q) =>
			q.eq("workspaceId", workspaceId).eq("server", server),
		)
		.unique();
}

export const catalog = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(v.object({ ...catalogRow.fields, fetchedAt: v.number() })),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const rows = await ctx.db
			.query("mcpCatalog")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(LIST_LIMIT);
		return rows.map(
			({ server, description, icon, login, tools, fetchedAt }) => ({
				server,
				...(description === undefined ? {} : { description }),
				...(icon === undefined ? {} : { icon }),
				...(login === undefined ? {} : { login }),
				tools,
				fetchedAt,
			}),
		);
	},
});

export const describe = mutation({
	args: { workspaceId: v.id("workspaces"), ...catalogRow.fields },
	returns: v.null(),
	handler: async (
		ctx,
		{ workspaceId, server, description, icon, login, tools },
	) => {
		await requireWorkspace(ctx, workspaceId);
		if (tools.length > MAX_MCP_MOUNT_BYTES)
			throw new Error(
				`the tools of ${server} exceed ${MAX_MCP_MOUNT_BYTES} bytes`,
			);
		if (!iconFits(icon))
			throw new Error(`the icon of ${server} is not an https or image url`);
		const row = {
			workspaceId,
			server,
			...(description === undefined
				? {}
				: { description: description.slice(0, MAX_MCP_DESCRIPTION_LENGTH) }),
			...(icon === undefined ? {} : { icon }),
			...(login === true ? { login } : {}),
			tools,
			fetchedAt: Date.now(),
		};
		const existing = await catalogOf(ctx, workspaceId, server);
		if (existing === null) await ctx.db.insert("mcpCatalog", row);
		else await ctx.db.replace(existing._id, row);
		return null;
	},
});

export const forget = mutation({
	args: { workspaceId: v.id("workspaces"), server: v.string() },
	returns: v.null(),
	handler: async (ctx, { workspaceId, server }) => {
		await requireWorkspace(ctx, workspaceId);
		const existing = await catalogOf(ctx, workspaceId, server);
		if (existing !== null) await ctx.db.delete(existing._id);
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
		const catalog = await ctx.db
			.query("mcpCatalog")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.take(PURGE_BATCH);
		for (const row of [...servers, ...mounts, ...catalog])
			await ctx.db.delete(row._id);
		if (
			servers.length === PURGE_BATCH ||
			mounts.length === PURGE_BATCH ||
			catalog.length === PURGE_BATCH
		)
			await ctx.scheduler.runAfter(0, internal.mcpServers.purge, {
				workspaceId,
			});
		return null;
	},
});

export const purgeInstance = internalMutation({
	args: { instance: v.string() },
	returns: v.null(),
	handler: async (ctx, { instance }) => {
		const servers = await ctx.db
			.query("mcpServers")
			.withIndex("by_instance", (q) => q.eq("instance", instance))
			.take(PURGE_BATCH);
		for (const row of servers) await ctx.db.delete(row._id);
		if (servers.length === PURGE_BATCH)
			await ctx.scheduler.runAfter(0, internal.mcpServers.purgeInstance, {
				instance,
			});
		return null;
	},
});
