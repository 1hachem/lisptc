import { CATALOGUED_CHOICES, type ProviderName } from "@repo/shared/providers";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { RETIRED_MODELS } from "./lib/models.js";

export const messageType = v.union(
	v.literal("human"),
	v.literal("ai"),
	v.literal("system"),
	v.literal("tool"),
);

export const chatStatus = v.union(
	v.literal("streaming"),
	v.literal("waiting"),
	v.literal("errored"),
);

function pair<P extends ProviderName, M extends string>(choice: {
	provider: P;
	model: M;
}) {
	return v.object({
		provider: v.literal(choice.provider),
		model: v.literal(choice.model),
	});
}

export const mcpServerPhase = v.union(
	v.literal("starting"),
	v.literal("ready"),
	v.literal("sleeping"),
	v.literal("failed"),
);

export const mcpStatePhase = v.union(
	v.literal("bound"),
	v.literal("pending"),
	v.literal("resizing"),
	v.literal("released"),
);

export const modelChoice = v.union(...CATALOGUED_CHOICES.map(pair));

export const storedModel = v.union(
	...[...CATALOGUED_CHOICES, ...RETIRED_MODELS].map(pair),
);

export default defineSchema({
	users: defineTable({
		authId: v.string(),
		name: v.string(),
		email: v.string(),
		image: v.optional(v.string()),
	}).index("by_auth", ["authId"]),

	preferences: defineTable({
		userId: v.id("users"),
		theme: v.optional(v.string()),
		font: v.optional(v.string()),
		themeUses: v.optional(v.record(v.string(), v.number())),
		channels: v.optional(v.record(v.string(), v.boolean())),
		metadata: v.optional(v.record(v.string(), v.boolean())),
		sidebar: v.optional(v.array(v.string())),
		hidden: v.optional(v.array(v.string())),
		motion: v.optional(v.string()),
	}).index("by_user", ["userId"]),

	workspaces: defineTable({
		ownerId: v.id("users"),
		name: v.string(),
		slug: v.string(),
		model: v.optional(storedModel),
	})
		.index("by_owner", ["ownerId"])
		.index("by_owner_slug", ["ownerId", "slug"]),

	chats: defineTable({
		workspaceId: v.id("workspaces"),
		userId: v.id("users"),
		title: v.string(),
		lastMessageAt: v.optional(v.number()),
		archivedAt: v.optional(v.number()),
		status: v.optional(chatStatus),
		streamingSince: v.optional(v.number()),
		failure: v.optional(v.string()),
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_workspace_live_activity", [
			"workspaceId",
			"archivedAt",
			"lastMessageAt",
		])
		.searchIndex("search_title", {
			searchField: "title",
			filterFields: ["workspaceId", "archivedAt"],
		}),

	messages: defineTable({
		chatId: v.id("chats"),
		workspaceId: v.id("workspaces"),
		seq: v.number(),
		type: messageType,
		content: v.string(),
		kwargs: v.optional(v.record(v.string(), v.any())),
		truncated: v.optional(v.boolean()),
		wireId: v.optional(v.string()),
	})
		.index("by_chat_seq", ["chatId", "seq"])
		.index("by_chat_wire", ["chatId", "wireId"])
		.index("by_workspace_type", ["workspaceId", "type"]),

	secrets: defineTable({
		workspaceId: v.id("workspaces"),
		key: v.string(),
		value: v.string(),
		description: v.string(),
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_workspace_key", ["workspaceId", "key"]),

	readmes: defineTable({
		workspaceId: v.id("workspaces"),
		body: v.string(),
	}).index("by_workspace", ["workspaceId"]),

	permissions: defineTable({
		workspaceId: v.id("workspaces"),
		source: v.string(),
	}).index("by_workspace", ["workspaceId"]),

	oauthRecords: defineTable({
		workspaceId: v.id("workspaces"),
		serverKey: v.string(),
		record: v.string(),
		pendingState: v.optional(v.string()),
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_workspace_server", ["workspaceId", "serverKey"])
		.index("by_pending_state", ["pendingState"]),

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

	mcpServers: defineTable({
		workspaceId: v.id("workspaces"),
		server: v.string(),
		phase: mcpServerPhase,
		reason: v.optional(v.string()),
		observedAt: v.number(),
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_workspace_server", ["workspaceId", "server"]),

	mcpState: defineTable({
		workspaceId: v.id("workspaces"),
		server: v.string(),
		name: v.string(),
		path: v.string(),
		size: v.string(),
		phase: mcpStatePhase,
		lastAttached: v.optional(v.number()),
		releasedAt: v.optional(v.number()),
		observedAt: v.number(),
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_workspace_server_name", ["workspaceId", "server", "name"]),
});
