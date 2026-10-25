import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import { authComponent } from "../auth.js";
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
		if (user === null || scope === null)
			throw new ConvexError({ code: "UNAUTHENTICATED" });
		return { user, scope };
	}
	return { user: await requireAccountUser(ctx) };
}

function inScope(caller: Caller, workspaceId: Id<"workspaces">): boolean {
	return caller.scope === undefined || caller.scope === workspaceId;
}

export async function requireUser(
	ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
	return (await requireCaller(ctx)).user;
}

async function requireAccountUser(
	ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
	const account = await authComponent.safeGetAuthUser(ctx);
	if (account === undefined) {
		throw new ConvexError({ code: "UNAUTHENTICATED" });
	}
	const user = await ctx.db
		.query("users")
		.withIndex("by_auth", (q) => q.eq("authId", account._id))
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
