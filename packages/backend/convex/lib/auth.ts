import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import { authComponent } from "../auth.js";

export async function requireUser(
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
	const user = await requireUser(ctx);
	const workspace = await ctx.db.get(workspaceId);
	if (workspace === null || workspace.ownerId !== user._id) {
		throw new ConvexError({ code: "FORBIDDEN" });
	}
	return { user, workspace };
}

export async function requireChat(
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
): Promise<{ user: Doc<"users">; chat: Doc<"chats"> }> {
	const user = await requireUser(ctx);
	const chat = await ctx.db.get(chatId);
	if (chat === null) {
		throw new ConvexError({ code: "FORBIDDEN" });
	}
	const workspace = await ctx.db.get(chat.workspaceId);
	if (workspace === null || workspace.ownerId !== user._id) {
		throw new ConvexError({ code: "FORBIDDEN" });
	}
	return { user, chat };
}
