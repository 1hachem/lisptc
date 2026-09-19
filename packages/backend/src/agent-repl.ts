import { compactionExtension } from "@repo/interpreter/compaction";
import { compactionHost } from "@repo/interpreter/compaction-host";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { memoryExtension } from "@repo/interpreter/memory";
import { memoryHostFor } from "@repo/interpreter/memory-host";
import { promisesExtension } from "@repo/interpreter/promises";
import { promisesHost } from "@repo/interpreter/promises-host";
import { proseExtension } from "@repo/interpreter/prose";
import { proseHost } from "@repo/interpreter/prose-host";
import { secretsExtension } from "@repo/interpreter/secrets";
import { secretsHost } from "@repo/interpreter/secrets-host";
import { uiExtension } from "@repo/interpreter/ui";
import { uiHost } from "@repo/interpreter/ui-host";
import { llmExtension } from "@repo/llm/llm";
import { llmHost } from "@repo/llm/llm-host";
import { mcpExtension } from "@repo/mcp";
import { LocalProcessHost } from "@repo/mcp/local-host";
import { mcpHostFor } from "@repo/mcp/mcp-host";
import type { OAuthRecord } from "@repo/mcp/ports";
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
