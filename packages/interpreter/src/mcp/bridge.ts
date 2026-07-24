/*
 * The synchronous bridge interface: how the (fully synchronous) interpreter
 * calls async MCP machinery.
 *
 * `request` is the blocking one-shot used by most built-ins. `post`/`wait`/
 * `poll` split it in two so Lisp code can fire several requests and collect
 * the results later (see the :async tool-call support and the await/poll
 * built-ins in src/mcp/index.ts) — the interpreter itself stays synchronous;
 * only the waiting is deferred.
 *
 * The default implementation is WorkerBridge (src/mcp/bridges/worker.ts):
 * a worker_threads broker plus SharedArrayBuffer + Atomics.wait. Any other
 * runtime (child process, remote broker, ...) can be swapped in by passing
 * an alternative SyncBridge to registerMcp(). A bridge that cannot separate
 * posting from waiting may throw from `post` — async support is an optional
 * capability.
 */
import type { Op } from "./protocol.ts";

export type TicketState = "pending" | "done" | "error";

// Opaque handle to an in-flight request. Concrete bridges attach whatever
// bookkeeping they need to their own ticket subtype.
export interface McpTicket {
	readonly id: string;
	readonly op: Op;
}

export interface SyncBridge {
	// Post a request and block until it completes; returns the decoded JSON
	// reply or throws on error/timeout.
	request(op: Op, payload: unknown, timeoutMs?: number): unknown;

	// Post a request without waiting; returns a ticket for wait/poll.
	post(op: Op, payload: unknown): McpTicket;

	// Block until the ticket completes and return its decoded reply (throws
	// on error/timeout). Waiting twice on the same ticket returns the same
	// outcome.
	wait(ticket: McpTicket, timeoutMs?: number): unknown;

	// Non-blocking status check.
	poll(ticket: McpTicket): TicketState;

	// Tear down the underlying runtime; outstanding tickets are abandoned.
	shutdown(): void;
}
