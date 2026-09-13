import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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
