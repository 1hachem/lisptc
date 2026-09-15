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
import { llmExtension } from "@repo/llm/llm";
import { llmHost } from "@repo/llm/llm-host";
import { mcpExtension } from "@repo/mcp";
import { mcpHostFor } from "@repo/mcp/mcp-host";
import { AgentRepl } from "@repo/repl/repl";

const MAX_THREADS = 50;

export function agentExtensions(scope?: string): InterpExtension[] {
	return [
		secretsExtension(secretsHost),
		promisesExtension(promisesHost),
		mcpExtension(mcpHostFor(scope)),
		llmExtension(llmHost),
		compactionExtension(compactionHost),
		memoryExtension(memoryHostFor(scope)),
		proseExtension(proseHost),
	];
}

function newAgentRepl(scope?: string): AgentRepl {
	return new AgentRepl({ extensions: agentExtensions(scope) });
}

const repls = new Map<string, AgentRepl>();

export function getThreadRepl(
	threadId: string | undefined,
	scope?: string,
): AgentRepl {
	if (!threadId) return newAgentRepl(scope);

	const existing = repls.get(threadId);
	if (existing) {
		repls.delete(threadId);
		repls.set(threadId, existing);
		return existing;
	}

	const repl = newAgentRepl(scope);
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
