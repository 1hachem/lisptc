/*
 * McpFuture — the Lisp-level handle for an in-flight :async MCP tool call.
 *
 * An opaque self-evaluating value returned by (server/tool :async t ...).
 * Resolve it with (await f [timeout-ms]), (await-all list) or check it with
 * (poll f); see src/mcp/index.ts. toString() is what the printer shows.
 */
import type { McpTicket } from "./bridge.ts";

export class McpFuture {
	constructor(
		readonly ticket: McpTicket,
		// Human-readable label, e.g. the "server/tool" name of the call.
		readonly label: string,
	) {}

	toString(): string {
		return `#<mcp-future:${this.label}:${this.ticket.id.slice(0, 8)}>`;
	}
}
