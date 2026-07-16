/*
 * Minimal stdio MCP server used by the test suite and for manual REPL driving.
 * Exposes one tool, `echo`, with a single required string argument `message`.
 * Uses the low-level SDK Server + raw JSON Schema so no extra deps are needed.
 *
 * Run manually:
 *   node --experimental-transform-types test/fixture-mcp-server.ts
 * or from Lisp:
 *   (load-mcp :name "fx" :command "node"
 *             :args ("--experimental-transform-types" "test/fixture-mcp-server.ts"))
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
	{ name: "fixture", version: "1.0.0" },
	{ capabilities: { tools: {} } },
);

const TOOLS = [
	{
		name: "echo",
		description: "Echo back the given message.",
		inputSchema: {
			type: "object",
			properties: {
				message: { type: "string", description: "the text to echo back" },
			},
			required: ["message"],
		},
	},
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
	if (req.params.name !== "echo")
		throw new Error(`unknown tool: ${req.params.name}`);
	const message = String(req.params.arguments?.message ?? "");
	return { content: [{ type: "text", text: message }] };
});

await server.connect(new StdioServerTransport());
