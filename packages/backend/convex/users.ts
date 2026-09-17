import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server.js";
import { requireUser } from "./lib/auth.js";

const PURGE_BATCH = 256;

export const me = query({
	args: {},
	returns: v.object({
		_id: v.id("users"),
		_creationTime: v.number(),
		authId: v.string(),
		name: v.string(),
		email: v.string(),
		image: v.optional(v.string()),
	}),
	handler: async (ctx) => await requireUser(ctx),
});

export const purge = internalMutation({
	args: { userId: v.id("users") },
	returns: v.null(),
	handler: async (ctx, { userId }) => {
		const workspaces = await ctx.db
			.query("workspaces")
			.withIndex("by_owner", (q) => q.eq("ownerId", userId))
			.take(PURGE_BATCH);
		for (const workspace of workspaces) {
			const chats = await ctx.db
				.query("chats")
				.withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
				.take(PURGE_BATCH);
			for (const chat of chats) {
				const messages = await ctx.db
					.query("messages")
					.withIndex("by_chat_seq", (q) => q.eq("chatId", chat._id))
					.take(PURGE_BATCH);
				for (const message of messages) await ctx.db.delete(message._id);
				if (messages.length < PURGE_BATCH) await ctx.db.delete(chat._id);
			}
			if (chats.length < PURGE_BATCH) await ctx.db.delete(workspace._id);
		}
		return null;
	},
});
