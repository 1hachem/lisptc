import { AgentRepl } from "@repo/repl/repl";

const MAX_THREADS = 50;

const repls = new Map<string, AgentRepl>();

export function getThreadRepl(threadId: string | undefined): AgentRepl {
	if (!threadId) return new AgentRepl();

	const existing = repls.get(threadId);
	if (existing) {
		repls.delete(threadId);
		repls.set(threadId, existing);
		return existing;
	}

	const repl = new AgentRepl();
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
