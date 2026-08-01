/*
 * Minimal stdio MCP server that completes the handshake but exposes ZERO tools.
 * It declares the `tools` capability and answers tools/list with an empty array
 * (rather than erroring), mimicking a degraded / unauthenticated / wrong-URL
 * connection. Used to test that load-mcp treats a tool-less connection as a
 * failure rather than a misleading `:loaded` server. Uses the low-level Server
 * because the high-level McpServer only advertises the tools capability once at
 * least one tool is registered.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
	{ name: "empty-fixture", version: "1.0.0" },
	{ capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));

await server.connect(new StdioServerTransport());
