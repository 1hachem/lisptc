import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const messageType = v.union(
	v.literal("human"),
	v.literal("ai"),
	v.literal("system"),
	v.literal("tool"),
);

export default defineSchema({
	users: defineTable({
		authId: v.string(),
		name: v.string(),
		email: v.string(),
		image: v.optional(v.string()),
	}).index("by_auth", ["authId"]),

	workspaces: defineTable({
		ownerId: v.id("users"),
		name: v.string(),
		slug: v.string(),
	})
		.index("by_owner", ["ownerId"])
		.index("by_owner_slug", ["ownerId", "slug"]),

	chats: defineTable({
		workspaceId: v.id("workspaces"),
		userId: v.id("users"),
		title: v.string(),
		lastMessageAt: v.optional(v.number()),
		archivedAt: v.optional(v.number()),
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_workspace_activity", ["workspaceId", "lastMessageAt"]),

	messages: defineTable({
		chatId: v.id("chats"),
		workspaceId: v.id("workspaces"),
		seq: v.number(),
		type: messageType,
		content: v.string(),
		additional_kwargs: v.optional(v.record(v.string(), v.any())),
		kwargs: v.optional(v.record(v.string(), v.any())),
		truncated: v.optional(v.boolean()),
	}).index("by_chat_seq", ["chatId", "seq"]),

	secrets: defineTable({
		workspaceId: v.id("workspaces"),
		key: v.string(),
		value: v.string(),
		description: v.string(),
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_workspace_key", ["workspaceId", "key"]),

	oauthRecords: defineTable({
		workspaceId: v.id("workspaces"),
		serverKey: v.string(),
		record: v.string(),
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_workspace_server", ["workspaceId", "serverKey"]),

	memories: defineTable({
		workspaceId: v.id("workspaces"),
		key: v.string(),
		body: v.string(),
		on: v.optional(v.string()),
		links: v.array(v.object({ key: v.string(), weight: v.number() })),
		score: v.number(),
		used: v.number(),
		lastUsed: v.number(),
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_workspace_key", ["workspaceId", "key"]),
});
