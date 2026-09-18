import { compactionExtension } from "@repo/interpreter/compaction";
import { compactionHost } from "@repo/interpreter/compaction-host";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { type MemoryStore, memoryExtension } from "@repo/interpreter/memory";
import { memoryHostFor } from "@repo/interpreter/memory-host";
import { promisesExtension } from "@repo/interpreter/promises";
import { promisesHost } from "@repo/interpreter/promises-host";
import { proseExtension } from "@repo/interpreter/prose";
import { proseHost } from "@repo/interpreter/prose-host";
import { type SecretsStore, secretsExtension } from "@repo/interpreter/secrets";
import { secretsHost } from "@repo/interpreter/secrets-host";
import { uiExtension } from "@repo/interpreter/ui";
import { uiHost } from "@repo/interpreter/ui-host";
import { llmExtension } from "@repo/llm/llm";
import { llmHost } from "@repo/llm/llm-host";
import { mcpExtension } from "@repo/mcp";
import { DockerHost } from "@repo/mcp/docker-host";
import { mcpHostFor } from "@repo/mcp/mcp-host";
import type { OAuthStore } from "@repo/mcp/ports";
import { AgentRepl } from "@repo/repl/repl";

const MAX_THREADS = 50;

export interface AgentReplOptions {
	scope?: string;
	memory?: MemoryStore;
	secrets?: SecretsStore;
	oauth?: OAuthStore;
}

export function agentExtensions(
	options: AgentReplOptions = {},
): InterpExtension[] {
	const { scope, memory, secrets, oauth } = options;
	return [
		secretsExtension({
			...secretsHost,
			...(secrets === undefined ? {} : { store: secrets }),
		}),
		promisesExtension(promisesHost),
		mcpExtension(mcpHostFor({ scope, oauth, host: new DockerHost() })),
		llmExtension(llmHost),
		compactionExtension(compactionHost),
		memoryExtension({
			...memoryHostFor(scope),
			...(memory === undefined ? {} : { store: memory }),
		}),
		proseExtension(proseHost),
		uiExtension(uiHost),
	];
}

function newAgentRepl(options: AgentReplOptions): AgentRepl {
	return new AgentRepl({ extensions: agentExtensions(options) });
}

const repls = new Map<string, AgentRepl>();

export function peekThreadRepl(threadId: string): AgentRepl | undefined {
	const existing = repls.get(threadId);
	if (!existing) return undefined;
	repls.delete(threadId);
	repls.set(threadId, existing);
	return existing;
}

export function getThreadRepl(
	threadId: string | undefined,
	options: AgentReplOptions = {},
): AgentRepl {
	if (!threadId) return newAgentRepl(options);

	const existing = repls.get(threadId);
	if (existing) {
		repls.delete(threadId);
		repls.set(threadId, existing);
		return existing;
	}

	const repl = newAgentRepl(options);
	repls.set(threadId, repl);
	while (repls.size > MAX_THREADS) {
		const oldest = repls.keys().next().value;
		if (oldest === undefined) break;
		evict(oldest);
	}
	return repl;
}

function evict(threadId: string): void {
	repls.delete(threadId);
}
