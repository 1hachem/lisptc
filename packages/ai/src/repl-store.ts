import { AgentRepl } from "@repo/repl/repl.ts";

/**
 * Per-thread REPL persistence.
 *
 * The HTTP API is otherwise stateless — the client replays the whole transcript
 * each turn so the model keeps its *textual* context. But the interpreter STATE
 * (definitions, loaded MCP servers, accumulated bindings) is NOT in that
 * transcript, so a fresh `AgentRepl` per request would silently drop everything
 * the agent built up earlier in the chat. Keying one long-lived `AgentRepl` on
 * the chat's `thread_id` makes that state survive across the chat's turns.
 *
 * A bounded LRU caps how many threads we keep alive at once; evicting a thread
 * shuts its MCP broker worker down so it doesn't keep a worker thread (and the
 * process) alive.
 */

const MAX_THREADS = 50;

// Insertion order doubles as LRU recency: a touched thread is re-inserted at the
// end, so the least-recently-used thread is always `keys().next()`.
const repls = new Map<string, AgentRepl>();

// A REPL with no thread id is ephemeral (one request), preserving the old
// stateless behavior for callers that don't carry a chat identity.
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

/*
 * The REPL a thread already has, or undefined.
 *
 * Unlike `getThreadRepl` this never creates one. A UI action is a click on a
 * widget some earlier turn rendered, so a thread with no live REPL means the
 * handler behind that widget is gone — a fresh interpreter would have neither
 * the action nor the state it closed over, and answering with one would run
 * nothing while looking like it worked.
 */
export function peekThreadRepl(threadId: string): AgentRepl | undefined {
	const existing = repls.get(threadId);
	if (!existing) return undefined;
	repls.delete(threadId);
	repls.set(threadId, existing);
	return existing;
}

// Drop a thread's REPL
// TODO:: should check the release or its MCP worker.
function evict(threadId: string): void {
	repls.delete(threadId);
}
