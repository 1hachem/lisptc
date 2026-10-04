import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
	type ActionCtx,
	action,
	env,
	internalMutation,
	internalQuery,
	type MutationCtx,
	mutation,
	query,
} from "./_generated/server.js";
import { requireWorkspace } from "./lib/auth.js";
import {
	cloneUrl,
	type GitCredential,
	probeRemote,
	type RemoteProblem,
} from "./lib/remote_probe.js";
import { seal } from "./lib/seal.js";
import { MAX_GIT_CREDENTIAL_BYTES, MAX_REMOTE_URL_BYTES } from "./limits.js";
import { remoteKind, remoteProblem } from "./schema.js";

const encoder = new TextEncoder();

const remoteView = v.object({
	kind: remoteKind,
	url: v.optional(v.string()),
	problem: v.optional(remoteProblem),
	checkedAt: v.optional(v.number()),
});

const outcome = v.object({ problem: v.optional(remoteProblem) });

export const get = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.union(remoteView, v.null()),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		const row = await ctx.db
			.query("remotes")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.unique();
		if (row === null) return null;
		return {
			kind: row.kind,
			url: row.url,
			problem: row.problem,
			checkedAt: row.checkedAt,
		};
	},
});

export const skip = mutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		await putRemote(ctx, { workspaceId, kind: "none" });
		return null;
	},
});

export const owned = internalQuery({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		await requireWorkspace(ctx, workspaceId);
		return null;
	},
});

const remoteRow = {
	workspaceId: v.id("workspaces"),
	kind: remoteKind,
	url: v.optional(v.string()),
	username: v.optional(v.string()),
	credential: v.optional(v.string()),
	problem: v.optional(remoteProblem),
	checkedAt: v.optional(v.number()),
};

const remoteRowValidator = v.object(remoteRow);

async function putRemote(
	ctx: MutationCtx,
	row: Infer<typeof remoteRowValidator>,
): Promise<void> {
	if ((await ctx.db.get(row.workspaceId)) === null) return;
	const existing = await ctx.db
		.query("remotes")
		.withIndex("by_workspace", (q) => q.eq("workspaceId", row.workspaceId))
		.unique();
	if (existing === null) await ctx.db.insert("remotes", row);
	else await ctx.db.replace(existing._id, row);
}

export const store = internalMutation({
	args: remoteRow,
	returns: v.null(),
	handler: async (ctx, row) => {
		await putRemote(ctx, row);
		return null;
	},
});

function credentialKey(): string {
	const key = env.GIT_CREDENTIAL_KEY;
	if (key === undefined)
		throw new ConvexError({ code: "GIT_CREDENTIALS_UNCONFIGURED" });
	return key;
}

async function settle(
	ctx: ActionCtx,
	workspaceId: Id<"workspaces">,
	kind: "own" | "hosted",
	url: string,
	credential: GitCredential,
): Promise<{ problem?: RemoteProblem }> {
	const problem = await probeRemote(url, credential);
	if (problem !== undefined) return { problem };
	await ctx.runMutation(internal.remotes.store, {
		workspaceId,
		kind,
		url,
		...(kind === "own"
			? {
					username: credential.username,
					credential: await seal(credentialKey(), credential.token),
				}
			: {}),
		checkedAt: Date.now(),
	});
	return {};
}

export const connect = action({
	args: {
		workspaceId: v.id("workspaces"),
		url: v.string(),
		username: v.optional(v.string()),
		token: v.string(),
	},
	returns: outcome,
	handler: async (ctx, { workspaceId, url, username, token }) => {
		await ctx.runQuery(internal.remotes.owned, { workspaceId });
		credentialKey();
		if (encoder.encode(url).length > MAX_REMOTE_URL_BYTES)
			return { problem: "BAD_URL" as const };
		if (
			encoder.encode(`${username ?? ""}${token}`).length >
			MAX_GIT_CREDENTIAL_BYTES
		)
			throw new ConvexError({ code: "GIT_CREDENTIAL_TOO_LARGE" });
		const parsed = cloneUrl(url);
		if (parsed === undefined) return { problem: "BAD_URL" as const };
		return await settle(ctx, workspaceId, "own", parsed.href, {
			username: username?.trim() || "x-access-token",
			token: token.trim(),
		});
	},
});

interface HostedConfig {
	base: string;
	owner: string;
	credential: GitCredential;
}

function hostedConfig(): HostedConfig {
	const base = env.HOSTED_GIT_URL;
	const owner = env.HOSTED_GIT_OWNER;
	const username = env.HOSTED_GIT_USERNAME;
	const token = env.HOSTED_GIT_TOKEN;
	if (!base || !owner || !username || !token)
		throw new ConvexError({ code: "HOSTED_GIT_UNAVAILABLE" });
	return {
		base: base.replace(/\/+$/, ""),
		owner,
		credential: { username, token },
	};
}

async function hostedRepo(config: HostedConfig, name: string): Promise<string> {
	const headers = {
		authorization: `token ${config.credential.token}`,
		"content-type": "application/json",
	};
	const created = await fetch(
		`${config.base}/api/v1/orgs/${config.owner}/repos`,
		{
			method: "POST",
			headers,
			body: JSON.stringify({ name, private: true, auto_init: false }),
		},
	);
	const found =
		created.status === 409
			? await fetch(`${config.base}/api/v1/repos/${config.owner}/${name}`, {
					headers,
				})
			: created;
	if (!found.ok) throw new ConvexError({ code: "HOSTED_GIT_FAILED" });
	const repo = (await found.json()) as { clone_url?: unknown };
	if (typeof repo.clone_url !== "string")
		throw new ConvexError({ code: "HOSTED_GIT_FAILED" });
	return repo.clone_url;
}

export const host = action({
	args: { workspaceId: v.id("workspaces") },
	returns: outcome,
	handler: async (ctx, { workspaceId }) => {
		await ctx.runQuery(internal.remotes.owned, { workspaceId });
		const config = hostedConfig();
		const url = await hostedRepo(config, `ws-${workspaceId}`);
		return await settle(ctx, workspaceId, "hosted", url, config.credential);
	},
});

export const purge = internalMutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.null(),
	handler: async (ctx, { workspaceId }) => {
		const rows = await ctx.db
			.query("remotes")
			.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
			.collect();
		for (const row of rows) await ctx.db.delete(row._id);
		return null;
	},
});
