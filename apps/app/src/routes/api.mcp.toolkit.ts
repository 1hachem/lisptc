import { createFileRoute } from "@tanstack/react-router";
import { mcpToolkit } from "../../server/agent/mcp-toolkit.ts";

export const Route = createFileRoute("/api/mcp/toolkit")({
	server: {
		handlers: ({ createHandlers }) => createHandlers({ POST: mcpToolkit }),
	},
});
