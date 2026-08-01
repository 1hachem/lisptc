/*
 * Minimal stdio MCP server used by the test suite and for manual REPL driving.
 * Exposes one tool, `echo`, with a single required string argument `message`.
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

// Optional startup delay so async-job tests can deterministically observe a
// load-mcp job in the :pending state before it connects.
const delayMs = Number(process.env.LISPTC_FIXTURE_DELAY_MS);
if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

await server.connect(new StdioServerTransport());
