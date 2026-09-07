import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { checkSyntax } from "@repo/interpreter";
import { MemoryRepl } from "@repo/repl/repl";
import { z } from "zod";

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
			code: z
				.string()
				.describe(
					"Lisptc source program to evaluate. Only the parenthesised forms " +
						"are evaluated; text around them is prose the interpreter ignores.",
				),
		},
	},
	async ({ code }) => ({
		content: [{ type: "text", text: await repl.eval(code) }],
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
			"errors (with 1-based line numbers). Only the parenthesised forms are " +
			"parsed, so prose around them is never an error. Does not touch REPL " +
			"state or run side effects — use it to validate a program before " +
			"evaluating it.",
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
