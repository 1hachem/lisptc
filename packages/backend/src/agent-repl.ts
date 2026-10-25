import { agentsExtension } from "@repo/agents-extension";
import { agentsHostFor } from "@repo/agents-extension/host";
import { MemoryJobs } from "@repo/agents-extension/jobs";
import type {
	AgentRunner,
	CodeRunner,
	Jobs,
	Notice,
} from "@repo/agents-extension/ports";
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
import { DockerHost } from "@repo/mcp-extension/docker-host";
import { mcpHostFor } from "@repo/mcp-extension/mcp-host";
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
import { SourceAgentStore } from "./agent-store.ts";
import { ConvexKnowledgeStore } from "./knowledge-store.ts";
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
}

export interface ThreadScope {
	readonly chatId?: Id<"chats">;
	readonly supervisor?: Supervisor;
	readonly jobs?: Jobs;
	readonly bounds?: readonly string[];
	readonly roster?: readonly string[];
}

export async function workspaceExtensions(
	workspaceId: Id<"workspaces">,
	connect: Connect,
	{ chatId, jobs, bounds, roster }: ThreadScope = {},
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
			definitions: new SourceAgentStore(
				new ConvexSourceFolder(connect),
				workspaceId,
				roster,
			),
			...(jobs === undefined ? {} : { jobs }),
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
	return [
		permissions,
		secretsExtension({
			...secretsHost,
			store: await ConvexSecretsStore.open(workspaceId, connect),
		}),
		promisesExtension(promisesHost),
		introspectionExtension(introspectionHost),
		agents,
		mcpExtension({
			...mcpHostFor({
				scope: workspaceId,
				oauth: workspaceOAuthStore(workspaceId, connect),
				host: new DockerHost(),
			}),
			policy: permissions.rules,
		}),
		llmExtension(llmHost),
		compactionExtension(compactionHost),
		memory,
		workspace,
		knowledge,
		preferencesExtension(
			preferencesHostFor({
				store: new ConvexPreferencesStore(connect),
				fonts,
				motions,
			}),
		),
		proseExtension(proseHost),
		uiExtension(uiHost),
		diagnosticsExtension(diagnosticsHost),
	];
}

export type JobsFor = (
	workspaceId: Id<"workspaces">,
	chatId: Id<"chats">,
) => Jobs;

export interface InProcess {
	readonly agents: AgentRunner;
	readonly code: CodeRunner;
	readonly notify?: (notice: Notice) => void;
}

export type RunnerFor = (
	workspaceId: Id<"workspaces">,
	chatId: Id<"chats">,
) => InProcess;

export function inProcessJobs(runnerFor: RunnerFor): JobsFor {
	const hosted = new Map<Id<"chats">, Jobs>();
	return (workspaceId, chatId) => {
		const standing = hosted.get(chatId);
		if (standing !== undefined) return standing;
		const { agents, code, notify } = runnerFor(workspaceId, chatId);
		const jobs = new MemoryJobs({ agents, code }, notify);
		hosted.set(chatId, jobs);
		return jobs;
	};
}
