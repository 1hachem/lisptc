import { CATALOGUED_CHOICES, type ProviderName } from "@repo/shared/providers";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { WORKSPACE_ICONS } from "./lib/workspaceIcons.js";

export const binnedFrom = v.union(
	v.literal("knowledge"),
	v.literal("attachments"),
);

export const messageType = v.union(
	v.literal("human"),
	v.literal("ai"),
	v.literal("system"),
	v.literal("tool"),
);

export const subAgent = v.object({
	name: v.string(),
	prompt: v.string(),
	bounds: v.array(v.string()),
	roster: v.optional(v.array(v.string())),
	budget: v.optional(v.number()),
});

export const chatStatus = v.union(
	v.literal("streaming"),
	v.literal("waiting"),
	v.literal("errored"),
	v.literal("stopped"),
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

export const workspaceIcon = v.union(
	...WORKSPACE_ICONS.map((icon) => v.literal(icon)),
);

export const panelContent = v.union(
	v.object({
		kind: v.literal("file"),
		folder: v.union(v.literal("attachments"), v.literal("knowledge")),
		name: v.string(),
	}),
	v.object({
		kind: v.literal("source"),
		folder: v.string(),
		name: v.string(),
	}),
	v.object({
		kind: v.literal("view"),
		title: v.string(),
		node: v.any(),
		chatId: v.optional(v.string()),
	}),
	v.object({
		kind: v.literal("chat"),
		chatId: v.union(v.string(), v.null()),
		title: v.string(),
		trace: v.optional(
			v.object({
				shown: v.union(v.literal("open"), v.literal("collapsed")),
				turn: v.optional(v.string()),
			}),
		),
	}),
	v.object({
		kind: v.literal("trace"),
		chatId: v.string(),
		title: v.string(),
		turn: v.optional(v.string()),
	}),
	v.object({
		kind: v.literal("page"),
		page: v.union(
			v.literal("memory"),
			v.literal("permission"),
			v.literal("readme"),
			v.literal("settings"),
			v.literal("preferences"),
			v.literal("account"),
			v.literal("bin"),
		),
		id: v.optional(v.string()),
		title: v.string(),
	}),
);

const panelTab = v.object({
	id: v.string(),
	fixed: v.optional(v.boolean()),
	content: panelContent,
});

export const panelLayout = v.object({
	root: v.union(v.string(), v.null()),
	focused: v.union(v.string(), v.null()),
	nodes: v.array(
		v.union(
			v.object({
				kind: v.literal("pane"),
				id: v.string(),
				tabs: v.array(panelTab),
				active: v.union(v.string(), v.null()),
			}),
			v.object({
				kind: v.literal("split"),
				id: v.string(),
				direction: v.union(v.literal("row"), v.literal("column")),
				children: v.array(v.string()),
				sizes: v.array(v.number()),
			}),
		),
	),
});

export default defineSchema({
	users: defineTable({
		authId: v.string(),
		name: v.string(),
		email: v.string(),
		image: v.optional(v.string()),
	}).index("by_auth", ["authId"]),

	preferences: defineTable({
		userId: v.id("users"),
		font: v.optional(v.string()),
		themeUses: v.optional(v.record(v.string(), v.number())),
		metadata: v.optional(v.record(v.string(), v.boolean())),
		input: v.optional(v.record(v.string(), v.boolean())),
		sidebar: v.optional(v.array(v.string())),
		hidden: v.optional(v.array(v.string())),
		statusBar: v.optional(v.array(v.string())),
		statusBarHidden: v.optional(v.array(v.string())),
		motion: v.optional(v.string()),
		panelMotion: v.optional(v.boolean()),
		traceBesideChat: v.optional(v.boolean()),
		traceLink: v.optional(v.boolean()),
	}).index("by_user", ["userId"]),

	workspaces: defineTable({
		ownerId: v.id("users"),
		name: v.string(),
		slug: v.string(),
		model: v.optional(modelChoice),
		icon: v.optional(workspaceIcon),
		theme: v.optional(v.string()),
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
		lastStartedAt: v.optional(v.number()),
		failure: v.optional(v.string()),
		replId: v.optional(v.id("repls")),
		parentChatId: v.optional(v.id("chats")),
		agent: v.optional(subAgent),
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_repl", ["replId"])
		.index("by_parent", ["parentChatId"])
		.index("by_workspace_live_activity", [
			"workspaceId",
			"archivedAt",
			"parentChatId",
			"lastMessageAt",
		])
		.searchIndex("search_title", {
			searchField: "title",
			filterFields: ["workspaceId", "archivedAt", "parentChatId"],
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
		layerId: v.optional(v.id("replLayers")),
	})
		.index("by_chat_seq", ["chatId", "seq"])
		.index("by_chat_wire", ["chatId", "wireId"])
		.index("by_workspace_type", ["workspaceId", "type"])
		.index("by_layer", ["layerId"]),

	secrets: defineTable({
		workspaceId: v.id("workspaces"),
		key: v.string(),
		value: v.string(),
		description: v.string(),
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_workspace_key", ["workspaceId", "key"]),

	knowledge: defineTable({
		workspaceId: v.id("workspaces"),
		name: v.string(),
		storageId: v.id("_storage"),
		contentType: v.optional(v.string()),
		size: v.number(),
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_workspace_name", ["workspaceId", "name"])
		.index("by_storage", ["storageId"]),
	attachments: defineTable({
		workspaceId: v.id("workspaces"),
		name: v.string(),
		storageId: v.id("_storage"),
		contentType: v.optional(v.string()),
		size: v.number(),
		attachedAt: v.number(),
	})
		.index("by_workspace", ["workspaceId"])
		.index("by_workspace_name", ["workspaceId", "name"])
		.index("by_attached", ["attachedAt"])
		.index("by_storage", ["storageId"]),
	bin: defineTable({
		workspaceId: v.id("workspaces"),
		name: v.string(),
		from: binnedFrom,
		storageId: v.id("_storage"),
		contentType: v.optional(v.string()),
		size: v.number(),
		binnedAt: v.number(),
	})
		.index("by_workspace_binned", ["workspaceId", "binnedAt"])
		.index("by_workspace_name", ["workspaceId", "name"])
		.index("by_binned", ["binnedAt"])
		.index("by_storage", ["storageId"]),

	readmes: defineTable({
		workspaceId: v.id("workspaces"),
		body: v.string(),
	}).index("by_workspace", ["workspaceId"]),

	permissions: defineTable({
		workspaceId: v.id("workspaces"),
		source: v.string(),
	}).index("by_workspace", ["workspaceId"]),

	layouts: defineTable({
		workspaceId: v.id("workspaces"),
		layout: panelLayout,
	}).index("by_workspace", ["workspaceId"]),

	repls: defineTable({
		workspaceId: v.id("workspaces"),
		chatId: v.id("chats"),
		head: v.optional(v.id("replLayers")),
	}).index("by_head", ["head"]),

	replLayers: defineTable({
		replId: v.id("repls"),
		parent: v.optional(v.id("replLayers")),
		origin: v.optional(v.string()),
		depth: v.number(),
		whole: v.boolean(),
		bytes: v.number(),
		chunks: v.number(),
	})
		.index("by_repl_origin", ["replId", "origin"])
		.index("by_parent", ["parent"]),

	replLayerChunks: defineTable({
		layerId: v.id("replLayers"),
		index: v.number(),
		data: v.string(),
	}).index("by_layer", ["layerId", "index"]),

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

	mcpMounts: defineTable({
		workspaceId: v.id("workspaces"),
		server: v.string(),
		conf: v.optional(v.string()),
		tools: v.string(),
		mountedAt: v.number(),
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

	sources: defineTable({
		workspaceId: v.id("workspaces"),
		folder: v.string(),
		name: v.string(),
		text: v.string(),
	}).index("by_workspace_folder_name", ["workspaceId", "folder", "name"]),
});
