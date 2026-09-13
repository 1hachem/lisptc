import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

process.stdout.on("error", () => {});

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
	"issues",
	{ description: "Return a JSON document in a text block.", inputSchema: {} },
	async () => ({
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({
					issues: [
						{ id: "a1f", title: "Auth token refresh fails" },
						{ id: "b2c", title: "Flaky login test" },
					],
					hasMore: false,
				}),
			},
		],
	}),
);

server.registerTool(
	"boom",
	{ description: "Always fails with a descriptive error.", inputSchema: {} },
	async () => ({
		content: [{ type: "text", text: "boom: something specific broke" }],
		isError: true,
	}),
);

const delayMs = Number(process.env.LISPTC_FIXTURE_DELAY_MS);
if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

await server.connect(new StdioServerTransport());
