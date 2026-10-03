import { finishAuthorization } from "@repo/mcp-extension/mcp-host";
import type { OAuthRecord } from "@repo/mcp-extension/ports";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { ConvexOAuthStore, type OAuthClient } from "./oauth-store.ts";

export function workspaceOAuthStore(
	workspaceId: Id<"workspaces">,
	connect: () => OAuthClient,
): ConvexOAuthStore<OAuthRecord> {
	return new ConvexOAuthStore<OAuthRecord>(
		workspaceId,
		connect,
		(record) => record.pending?.state,
	);
}

export async function finishOAuth(
	connect: () => OAuthClient,
	callbackUrl: string,
): Promise<boolean> {
	const state = new URL(callbackUrl).searchParams.get("state");
	if (!state) return false;
	const pending = await connect().query(api.oauth.pendingFor, { state });
	if (pending === null) return false;
	await finishAuthorization(
		workspaceOAuthStore(pending.workspaceId, connect),
		pending.serverKey,
		callbackUrl,
	);
	return true;
}
