/*
 * Minimal stdio MCP server used by the test suite and for manual REPL driving.
 * Exposes `echo` (required string argument `message`) and `slow-echo`
 * (`message` plus a `ms` delay, for exercising :async calls).
 * Uses the SDK's high-level `McpServer` (the low-level `Server` is deprecated).
 *
 * Run manually:
 *   node --experimental-transform-types test/fixture-mcp-server.ts
 * or from Lisp:
 *   (load-mcp :name "fx" :command "node"
 *             :args ("--experimental-transform-types" "test/fixture-mcp-server.ts"))
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fixture", version: "1.0.0" });

server.registerTool(
	"echo",
	{
		description: "Echo back the given message.",
		inputSchema: {
			message: z.string().describe("the text to echo back"),
		},
	},
	async ({ message }) => ({
		content: [{ type: "text", text: String(message) }],
	}),
);

server.registerTool(
	"slow-echo",
	{
		description: "Echo back the given message after a delay.",
		inputSchema: {
			message: z.string().describe("the text to echo back"),
			ms: z.number().describe("delay in milliseconds"),
		},
	},
	async ({ message, ms }) => {
		await new Promise((resolve) => setTimeout(resolve, Number(ms)));
		return { content: [{ type: "text", text: String(message) }] };
	},
);

server.registerTool(
	"fail",
	{
		description: "Always fails with the given error message.",
		inputSchema: {
			message: z.string().describe("the error text to fail with"),
		},
	},
	async ({ message }) => ({
		isError: true,
		content: [{ type: "text", text: String(message) }],
	}),
);

await server.connect(new StdioServerTransport());
