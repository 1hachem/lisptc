import { compactionExtension } from "@repo/interpreter/compaction";
import type { InterpExtension } from "@repo/interpreter/lisp";
import {
	MemoryBank,
	memoryExtension,
	scopedMemoryStore,
} from "@repo/interpreter/memory";
import { promisesExtension } from "@repo/interpreter/promises";
import { proseExtension } from "@repo/interpreter/prose";
import { secretsExtension } from "@repo/interpreter/secrets";
import { llmExtension } from "@repo/llm/llm";
import { mcpExtension } from "@repo/mcp";
import { AgentRepl } from "@repo/repl/repl";

const MAX_THREADS = 50;

export function agentExtensions(scope?: string): InterpExtension[] {
	return [
		secretsExtension(),
		promisesExtension(),
		mcpExtension(),
		llmExtension(),
		compactionExtension(),
		memoryExtension(new MemoryBank(scopedMemoryStore(scope))),
		proseExtension(),
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
