/*
 * Minimal stdio MCP server used by the test suite to exercise enum rendering.
 * Exposes one tool, `render`, whose required `format` argument is constrained to
 * an enum (["png", "jpeg"]) so tests can assert that `doc` surfaces the
 * allowed values.
 *
 * Run manually:
 *   node --no-warnings --experimental-transform-types test/fixture-enum-mcp-server.ts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// See fixture-mcp-server.ts: guards against an EPIPE crash if the parent
// tears down the pipe mid-write.
process.stdout.on("error", () => {});

const server = new McpServer({ name: "fixture-enum", version: "1.0.0" });

server.registerTool(
	"render",
	{
		description: "Render in the requested format.",
		inputSchema: {
			format: z.enum(["png", "jpeg"]).describe("the output image format"),
		},
	},
	async ({ format }) => ({
		content: [{ type: "text", text: String(format) }],
	}),
);

await server.connect(new StdioServerTransport());
