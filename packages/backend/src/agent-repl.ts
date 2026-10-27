import { agentsExtension, subAgentExtension } from "@repo/agents-extension";
import { agentsHostFor, subAgentHost } from "@repo/agents-extension/host";
import type { Threads } from "@repo/ai";
import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { diagnosticsExtension } from "@repo/diagnostics-extension";
import { diagnosticsHost } from "@repo/diagnostics-extension/host";
import type { Image } from "@repo/interpreter/image";
import type { InterpExtension } from "@repo/interpreter/session";
import { introspectionExtension } from "@repo/introspection-extension";
import { introspectionHost } from "@repo/introspection-extension/host";
import { knowledgeExtension } from "@repo/knowledge-extension";
import { knowledgeHostFor } from "@repo/knowledge-extension/host";
import { llmExtension } from "@repo/llm-extension/llm-extension";
import { llmHost } from "@repo/llm-extension/llm-host";
import { mcpExtension } from "@repo/mcp-extension";
import { containerHost, mcpHostFor } from "@repo/mcp-extension/mcp-host";
import type { ServerReporter } from "@repo/mcp-extension/ports";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHostFor } from "@repo/memory-extension/host";
import { permissionsExtension } from "@repo/permissions-extension";
import { permissionsHostFor } from "@repo/permissions-extension/host";
import { preferencesExtension } from "@repo/preferences-extension";
import { preferencesHostFor } from "@repo/preferences-extension/host";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { secretsExtension } from "@repo/secrets-extension";
import { secretsHost } from "@repo/secrets-extension/host";
import { fonts } from "@repo/ui/fonts.ts";
import { motions } from "@repo/ui/motions.ts";
import { defaultThemeId, themes } from "@repo/ui/themes";
import { uiExtension } from "@repo/ui-extension";
import { uiHost } from "@repo/ui-extension/host";
import { workspaceExtension } from "@repo/workspace-extension";
import { workspaceHostFor } from "@repo/workspace-extension/host";
import type { ConvexHttpClient } from "convex/browser";
import type { Infer } from "convex/values";
import type { Id } from "../convex/_generated/dataModel.js";
import { WORKSPACE_ICONS } from "../convex/lib/workspaceIcons.ts";
import { MAX_KNOWLEDGE_BYTES } from "../convex/limits.js";
import type { subAgent } from "../convex/schema.js";
import { SupervisedAgents } from "./agent-threads.ts";
import { ConvexKnowledgeStore } from "./knowledge-store.ts";
import { ConvexMcpRegistry } from "./mcp-registry.ts";
import { ConvexMemoryStore } from "./memory-store.ts";
import { workspaceOAuthStore } from "./oauth-callback.ts";
import { ConvexPermissionsStore } from "./permissions-store.ts";
import { ConvexPreferencesStore } from "./preferences-store.ts";
import { ConvexSecretsStore } from "./secrets-store.ts";
import { ConvexSourceFolder } from "./source-folder.ts";
import { ConvexWorkspaceStore, OFFERED_MODELS } from "./workspace-store.ts";

export type WorkspaceClient = Pick<
	ConvexHttpClient,
	"query" | "mutation" | "url"
>;

export type Connect = () => WorkspaceClient;

function reportsOf(
	workspaceId: Id<"workspaces">,
	connect: Connect,
): ServerReporter {
	let reported: Promise<unknown> = Promise.resolve();
	return (report) => {
		reported = reported
			.then(() =>
				connect().mutation(api.mcpServers.report, { workspaceId, ...report }),
			)
			.catch(() => {});
	};
}

const themeChoices = themes.map((theme) => ({
	id: theme.id,
	name: `${theme.name} ${theme.scheme}`,
	family: theme.name,
	scheme: theme.scheme,
}));

export type ChildRecord = Infer<typeof subAgent>;

export interface Supervisor {
	readonly threads: Threads;
	spawn(
		parent: Id<"chats">,
		agent: ChildRecord,
		image?: Image,
	): Promise<Id<"chats">>;
	copyTranscript(from: Id<"chats">, to: Id<"chats">): Promise<void>;
	child(parent: Id<"chats">, name: string): Promise<Id<"chats"> | undefined>;
	image(parent: Id<"chats">, child: Id<"chats">): Promise<Image | undefined>;
}

export interface ThreadScope {
	readonly chatId?: Id<"chats">;
	readonly supervisor?: Supervisor;
	readonly bounds?: readonly string[];
	readonly roster?: readonly string[];
	readonly subAgent?: boolean;
}

export async function workspaceExtensions(
	workspaceId: Id<"workspaces">,
	connect: Connect,
	{ chatId, supervisor, bounds, roster, subAgent }: ThreadScope = {},
): Promise<InterpExtension[]> {
	const memory = memoryExtension({
		...memoryHostFor(workspaceId),
		store: new ConvexMemoryStore(workspaceId, connect),
	});
	const workspace = workspaceExtension(
		workspaceHostFor({
			store: new ConvexWorkspaceStore(workspaceId, connect),
			models: OFFERED_MODELS,
			icons: WORKSPACE_ICONS,
			themes: themeChoices,
			defaultDarkTheme: defaultThemeId,
			chatId,
		}),
	);
	const knowledge = knowledgeExtension(
		knowledgeHostFor({
			store: new ConvexKnowledgeStore(workspaceId, connect),
			maxDownloadBytes: MAX_KNOWLEDGE_BYTES,
		}),
	);
	const agents = agentsExtension(
		agentsHostFor({
			folder: new ConvexSourceFolder(connect),
			workspace: workspaceId,
			...(roster === undefined ? {} : { roster }),
			...(supervisor === undefined || chatId === undefined
				? {}
				: { threads: new SupervisedAgents(supervisor, chatId) }),
		}),
	);
	const permissions = permissionsExtension(
		permissionsHostFor({
			store: await ConvexPermissionsStore.open(workspaceId, connect),
			asks: [
				...memory.asks,
				...workspace.asks,
				...knowledge.asks,
				...agents.asks,
			],
			...(bounds === undefined ? {} : { bounds }),
		}),
	);
	const preferences = preferencesExtension(
		preferencesHostFor({
			store: new ConvexPreferencesStore(connect),
			fonts,
			motions,
		}),
	);
	const ui = uiExtension(uiHost);
	const exports = subAgentExtension(subAgentHost());
	const rootOnly: InterpExtension[] = subAgent
		? [agents, workspace, preferences, ui]
		: [exports];
	return [
		permissions,
		secretsExtension({
			...secretsHost,
			store: await ConvexSecretsStore.open(workspaceId, connect),
		}),
		promisesExtension(promisesHost),
		introspectionExtension(introspectionHost),
		agents,
		exports,
		mcpExtension({
			...mcpHostFor({
				scope: workspaceId,
				oauth: workspaceOAuthStore(workspaceId, connect),
				host: containerHost(workspaceId, reportsOf(workspaceId, connect)),
			}),
			policy: permissions.rules,
			registry: new ConvexMcpRegistry(workspaceId, connect),
		}),
		llmExtension(llmHost),
		compactionExtension(compactionHost),
		memory,
		workspace,
		knowledge,
		preferences,
		proseExtension(proseHost),
		ui,
		diagnosticsExtension(diagnosticsHost),
	].filter((extension) => !rootOnly.includes(extension));
}
