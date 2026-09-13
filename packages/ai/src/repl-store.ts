import { compactionExtension } from "@repo/interpreter/compaction";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { promisesExtension } from "@repo/interpreter/promises";
import { proseExtension } from "@repo/interpreter/prose";
import { secretsExtension } from "@repo/interpreter/secrets";
import { llmExtension } from "@repo/llm/llm";
import { mcpExtension } from "@repo/mcp";
import { AgentRepl } from "@repo/repl/repl";

const MAX_THREADS = 50;

export function agentExtensions(): InterpExtension[] {
	return [
		secretsExtension(),
		promisesExtension(),
		mcpExtension(),
		llmExtension(),
		compactionExtension(),
		proseExtension(),
	];
}

function newAgentRepl(): AgentRepl {
	return new AgentRepl({ extensions: agentExtensions() });
}

const repls = new Map<string, AgentRepl>();

export function getThreadRepl(threadId: string | undefined): AgentRepl {
	if (!threadId) return newAgentRepl();

	const existing = repls.get(threadId);
	if (existing) {
		repls.delete(threadId);
		repls.set(threadId, existing);
		return existing;
	}

	const repl = newAgentRepl();
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
