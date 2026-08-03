// A stdio MCP server that exposes the Lisptc REPL to an MCP client (e.g. Claude
// Code). It holds ONE persistent `MemoryRepl` for the whole process, so
// definitions, imports, and loaded MCP servers survive across tool calls —
// mirroring how the pi extension runs the interpreter in-process, but driven by
// an MCP client instead of a pi session.
//
// Run over stdio: `node --experimental-transform-types src/server.ts`.
import { checkSyntax } from "@repo/interpreter";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MemoryRepl } from "@repo/repl/repl.ts";
import { z } from "zod";

// The single long-lived REPL. State persists for the lifetime of the server.
const repl = new MemoryRepl();

const server = new McpServer({
	name: "lisptc-repl",
	version: "0.0.0",
});

server.registerTool(
	"lisp-eval",
	{
		title: "Evaluate Lisptc",
		description:
			"Evaluate Lisptc source in a persistent REPL and return what the " +
			"interactive REPL would print (last value plus any side-effect output; " +
			"errors are rendered inline, not thrown). Definitions and loaded MCP " +
			"servers persist across calls within a session.",
		inputSchema: {
			code: z.string().describe("Lisptc source program to evaluate."),
		},
	},
	async ({ code }) => ({
		content: [{ type: "text", text: repl.eval(code) }],
	}),
);

server.registerTool(
	"lisp-reset",
	{
		title: "Reset the REPL",
		description:
			"Discard all definitions and start from a fresh prelude-loaded " +
			"interpreter. Use to clear accumulated state.",
		inputSchema: {},
	},
	async () => {
		repl.reset();
		return { content: [{ type: "text", text: "REPL reset.\n" }] };
	},
);

server.registerTool(
	"lisp-check",
	{
		title: "Check Lisptc syntax",
		description:
			"Parse Lisptc source WITHOUT evaluating it and report any syntax " +
			"errors (with 1-based line numbers). Does not touch REPL state or run " +
			"side effects — use it to validate a program before evaluating it.",
		inputSchema: {
			code: z.string().describe("Lisptc source program to parse."),
		},
	},
	async ({ code }) => {
		const errors = checkSyntax(code);
		const text =
			errors.length === 0
				? "OK — no syntax errors.\n"
				: errors.map((e) => `line ${e.line}: ${e.message}`).join("\n");
		return { content: [{ type: "text", text }] };
	},
);

const transport = new StdioServerTransport();
await server.connect(transport);
