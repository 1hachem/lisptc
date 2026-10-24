import { agentsExtension } from "@repo/agents-extension";
import { agentsHostFor } from "@repo/agents-extension/host";
import { MemoryAgentJobs } from "@repo/agents-extension/jobs";
import type {
	AgentJobs,
	AgentRunner,
	Notice,
	ReplSeed,
} from "@repo/agents-extension/ports";
import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { diagnosticsExtension } from "@repo/diagnostics-extension";
import { diagnosticsHost } from "@repo/diagnostics-extension/host";
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
import { MemoryImageStore } from "@repo/repl/image-store";
import { AgentRepl } from "@repo/repl/repl";
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
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { WORKSPACE_ICONS } from "../convex/lib/workspaceIcons.ts";
import { MAX_KNOWLEDGE_BYTES } from "../convex/limits.js";
import { ConvexAgentStore } from "./agent-store.ts";
import { ConvexImageStore } from "./image-store.ts";
import { ConvexKnowledgeStore } from "./knowledge-store.ts";
import { ConvexMemoryStore } from "./memory-store.ts";
import { workspaceOAuthStore } from "./oauth-callback.ts";
import { ConvexPermissionsStore } from "./permissions-store.ts";
import { ConvexPreferencesStore } from "./preferences-store.ts";
import { ConvexSecretsStore } from "./secrets-store.ts";
import type { ServerClient } from "./server-client.ts";
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

export interface SessionScope {
	readonly chatId?: Id<"chats">;
	readonly jobs?: AgentJobs;
	readonly bounds?: readonly string[];
}

export async function workspaceExtensions(
	workspaceId: Id<"workspaces">,
	connect: Connect,
	{ chatId, jobs, bounds }: SessionScope = {},
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
			definitions: new ConvexAgentStore(workspaceId, connect),
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
) => AgentJobs;

export interface InProcess {
	readonly runner: AgentRunner;
	readonly notify?: (notice: Notice) => void;
}

export type RunnerFor = (
	workspaceId: Id<"workspaces">,
	chatId: Id<"chats">,
) => InProcess;

export function inProcessJobs(runnerFor: RunnerFor): JobsFor {
	return (workspaceId, chatId) => {
		const { runner, notify } = runnerFor(workspaceId, chatId);
		return new MemoryAgentJobs(runner, notify);
	};
}

export interface Seeded {
	readonly seed: ReplSeed;
	readonly bounds?: readonly string[];
	readonly runner?: AgentRunner;
}

export async function seededRepl(
	workspaceId: Id<"workspaces">,
	connect: Connect,
	{ seed, bounds, runner }: Seeded,
): Promise<AgentRepl> {
	const images = new MemoryImageStore();
	const repl = new AgentRepl({
		extensions: await workspaceExtensions(workspaceId, connect, {
			...(runner === undefined ? {} : { jobs: new MemoryAgentJobs(runner) }),
			...(bounds === undefined ? {} : { bounds }),
		}),
		images,
	});
	if (seed.from === "fork") {
		await images.save(seed.image);
		await repl.resume();
	}
	return repl;
}

export function chatRepls(
	connect: Connect,
	server: ServerClient,
	jobsFor?: JobsFor,
): (chatId: Id<"chats">) => Promise<AgentRepl> {
	return async (chatId) => {
		const { workspaceId } = await connect().query(api.chats.get, { chatId });
		const replId = await connect().mutation(api.repls.open, { chatId });
		const repl = new AgentRepl({
			extensions: await workspaceExtensions(workspaceId, connect, {
				chatId,
				...(jobsFor === undefined
					? {}
					: { jobs: jobsFor(workspaceId, chatId) }),
			}),
			images: new ConvexImageStore(replId, server),
		});
		await repl.resume().catch((ex) => {
			console.error(`[backend] chat ${chatId} resumed fresh:`, ex);
		});
		return repl;
	};
}
