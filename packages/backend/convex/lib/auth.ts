import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import { components } from "../_generated/api.js";
import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import { ACTING_ISSUER } from "./acting.ts";

interface Caller {
	readonly user: Doc<"users">;
	readonly scope?: Id<"workspaces">;
}

async function requireCaller(ctx: QueryCtx | MutationCtx): Promise<Caller> {
	const identity = await ctx.auth.getUserIdentity();
	if (identity?.issuer === ACTING_ISSUER) {
		const userId = ctx.db.normalizeId("users", identity.subject);
		const scope = ctx.db.normalizeId(
			"workspaces",
			String(identity.workspaceId),
		);
		const user = userId === null ? null : await ctx.db.get(userId);
		const workspace = scope === null ? null : await ctx.db.get(scope);
		if (user === null || scope === null || workspace?.ownerId !== user._id)
			throw new ConvexError({ code: "UNAUTHENTICATED" });
		return { user, scope };
	}
	if (identity === null) throw new ConvexError({ code: "UNAUTHENTICATED" });
	return { user: await requireAccountUser(ctx, identity) };
}

function inScope(caller: Caller, workspaceId: Id<"workspaces">): boolean {
	return caller.scope === undefined || caller.scope === workspaceId;
}

export async function requireUser(
	ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
	const caller = await requireCaller(ctx);
	if (caller.scope !== undefined) throw new ConvexError({ code: "FORBIDDEN" });
	return caller.user;
}

export async function requireUserOrThread(
	ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
	return (await requireCaller(ctx)).user;
}

async function requireLiveSession(
	ctx: QueryCtx | MutationCtx,
	identity: UserIdentity,
): Promise<void> {
	const { sessionId } = identity;
	if (typeof sessionId !== "string")
		throw new ConvexError({ code: "UNAUTHENTICATED" });
	const session = await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: "session",
		where: [
			{ field: "_id", value: sessionId },
			{ field: "userId", value: identity.subject },
			{ field: "expiresAt", operator: "gt", value: Date.now() },
		],
	});
	if (session === null) throw new ConvexError({ code: "UNAUTHENTICATED" });
}

async function requireAccountUser(
	ctx: QueryCtx | MutationCtx,
	identity: UserIdentity,
): Promise<Doc<"users">> {
	await requireLiveSession(ctx, identity);
	const user = await ctx.db
		.query("users")
		.withIndex("by_auth", (q) => q.eq("authId", identity.subject))
		.unique();
	if (user === null) {
		throw new ConvexError({ code: "NOT_PROVISIONED" });
	}
	return user;
}

export async function requireWorkspace(
	ctx: QueryCtx | MutationCtx,
	workspaceId: Id<"workspaces">,
): Promise<{ user: Doc<"users">; workspace: Doc<"workspaces"> }> {
	const caller = await requireCaller(ctx);
	const { user } = caller;
	const workspace = await ctx.db.get(workspaceId);
	if (
		workspace === null ||
		workspace.ownerId !== user._id ||
		!inScope(caller, workspaceId)
	) {
		throw new ConvexError({ code: "FORBIDDEN" });
	}
	return { user, workspace };
}

export async function requireChat(
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
): Promise<{ user: Doc<"users">; chat: Doc<"chats"> }> {
	const caller = await requireCaller(ctx);
	const { user } = caller;
	const chat = await ctx.db.get(chatId);
	if (chat === null || !inScope(caller, chat.workspaceId)) {
		throw new ConvexError({ code: "FORBIDDEN" });
	}
	const workspace = await ctx.db.get(chat.workspaceId);
	if (workspace === null || workspace.ownerId !== user._id) {
		throw new ConvexError({ code: "FORBIDDEN" });
	}
	return { user, chat };
}
