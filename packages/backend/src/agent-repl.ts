import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHostFor } from "@repo/memory-extension/host";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { secretsExtension } from "@repo/secrets-extension";
import { secretsHost } from "@repo/secrets-extension/host";
import { uiExtension } from "@repo/ui-extension";
import { uiHost } from "@repo/ui-extension/host";
import { llmExtension } from "@repo/llm-extension/llm-extension";
import { llmHost } from "@repo/llm-extension/llm-host";
import { mcpExtension } from "@repo/mcp-extension";
import { LocalProcessHost } from "@repo/mcp-extension/local-host";
import { mcpHostFor } from "@repo/mcp-extension/mcp-host";
import type { OAuthRecord } from "@repo/mcp-extension/ports";
import { AgentRepl } from "@repo/repl/repl";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { ConvexMemoryStore } from "./memory-store.ts";
import { ConvexOAuthStore } from "./oauth-store.ts";
import { ConvexSecretsStore } from "./secrets-store.ts";

export type WorkspaceClient = Pick<ConvexHttpClient, "query" | "mutation">;

export type Connect = () => WorkspaceClient;

export async function workspaceExtensions(
	workspaceId: Id<"workspaces">,
	connect: Connect,
): Promise<InterpExtension[]> {
	return [
		secretsExtension({
			...secretsHost,
			store: await ConvexSecretsStore.open(workspaceId, connect),
		}),
		promisesExtension(promisesHost),
		mcpExtension(
			mcpHostFor({
				scope: workspaceId,
				oauth: new ConvexOAuthStore<OAuthRecord>(workspaceId, connect),
				host: new LocalProcessHost(),
			}),
		),
		llmExtension(llmHost),
		compactionExtension(compactionHost),
		memoryExtension({
			...memoryHostFor(workspaceId),
			store: new ConvexMemoryStore(workspaceId, connect),
		}),
		proseExtension(proseHost),
		uiExtension(uiHost),
	];
}

export async function openWorkspaceRepl(
	workspaceId: Id<"workspaces">,
	connect: Connect,
): Promise<AgentRepl> {
	return new AgentRepl({
		extensions: await workspaceExtensions(workspaceId, connect),
	});
}

export function chatRepls(
	connect: Connect,
): (chatId: Id<"chats">) => Promise<AgentRepl> {
	return async (chatId) => {
		const { workspaceId } = await connect().query(api.chats.get, { chatId });
		return openWorkspaceRepl(workspaceId, connect);
	};
}
