import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { diagnosticsExtension } from "@repo/diagnostics-extension";
import { diagnosticsHost } from "@repo/diagnostics-extension/host";
import type { InterpExtension } from "@repo/interpreter/session";
import { introspectionExtension } from "@repo/introspection-extension";
import { introspectionHost } from "@repo/introspection-extension/host";
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
import { AgentRepl } from "@repo/repl/repl";
import { secretsExtension } from "@repo/secrets-extension";
import { secretsHost } from "@repo/secrets-extension/host";
import { fonts } from "@repo/ui/fonts.ts";
import { themes } from "@repo/ui/themes";
import { uiExtension } from "@repo/ui-extension";
import { uiHost } from "@repo/ui-extension/host";
import { workspaceExtension } from "@repo/workspace-extension";
import { workspaceHostFor } from "@repo/workspace-extension/host";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { ConvexMemoryStore } from "./memory-store.ts";
import { workspaceOAuthStore } from "./oauth-callback.ts";
import { ConvexPermissionsStore } from "./permissions-store.ts";
import { ConvexPreferencesStore } from "./preferences-store.ts";
import { ConvexSecretsStore } from "./secrets-store.ts";
import { ConvexWorkspaceStore, OFFERED_MODELS } from "./workspace-store.ts";

export type WorkspaceClient = Pick<ConvexHttpClient, "query" | "mutation">;

export type Connect = () => WorkspaceClient;

export async function workspaceExtensions(
	workspaceId: Id<"workspaces">,
	connect: Connect,
	chatId?: Id<"chats">,
): Promise<InterpExtension[]> {
	const memory = memoryExtension({
		...memoryHostFor(workspaceId),
		store: new ConvexMemoryStore(workspaceId, connect),
	});
	const workspace = workspaceExtension(
		workspaceHostFor({
			store: new ConvexWorkspaceStore(workspaceId, connect),
			models: OFFERED_MODELS,
			chatId,
		}),
	);
	const permissions = permissionsExtension(
		permissionsHostFor({
			store: await ConvexPermissionsStore.open(workspaceId, connect),
			asks: [...memory.asks, ...workspace.asks],
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
		preferencesExtension(
			preferencesHostFor({
				store: new ConvexPreferencesStore(connect),
				themes: themes.map((theme) => ({
					id: theme.id,
					name: `${theme.name} ${theme.scheme}`,
				})),
				fonts,
			}),
		),
		proseExtension(proseHost),
		uiExtension(uiHost),
		diagnosticsExtension(diagnosticsHost),
	];
}

export async function openWorkspaceRepl(
	workspaceId: Id<"workspaces">,
	connect: Connect,
	chatId?: Id<"chats">,
): Promise<AgentRepl> {
	return new AgentRepl({
		extensions: await workspaceExtensions(workspaceId, connect, chatId),
	});
}

export function chatRepls(
	connect: Connect,
): (chatId: Id<"chats">) => Promise<AgentRepl> {
	return async (chatId) => {
		const { workspaceId } = await connect().query(api.chats.get, { chatId });
		return openWorkspaceRepl(workspaceId, connect, chatId);
	};
}
