import { createFileRoute } from "@tanstack/react-router";
import { mcpAction } from "../../server/agent/mcp-action.ts";

export const Route = createFileRoute("/api/mcp/action")({
	server: {
		handlers: ({ createHandlers }) => createHandlers({ POST: mcpAction }),
	},
});
