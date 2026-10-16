import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { checkSource } from "@repo/lint-extension";
import { z } from "zod";
import { newRepl } from "./repl.ts";

const repl = newRepl();

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
		title: "Check Lisptc source",
		description:
			"Check Lisptc source WITHOUT evaluating it, the same check the agent " +
			"runs before every step, and report each problem with its 1-based " +
			"line number: a form left open, source that does not read, a call " +
			"with the wrong number of arguments or a missing required keyword " +
			"argument, measured against what this REPL has defined. Only the " +
			"parenthesised forms are checked, so prose around them is never an " +
			"error. Does not change REPL state or run side effects — use it to " +
			"validate a program before evaluating it.",
		inputSchema: {
			code: z.string().describe("Lisptc source program to check."),
		},
	},
	async ({ code }) => {
		const problems = checkSource(repl.interp, code);
		const text =
			problems.length === 0
				? "OK — no problems found.\n"
				: problems.map((p) => `line ${p.line}: ${p.message}`).join("\n");
		return { content: [{ type: "text", text }] };
	},
);

const transport = new StdioServerTransport();
await server.connect(transport);
