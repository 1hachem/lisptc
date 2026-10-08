import { createFileRoute } from "@tanstack/react-router";
import { uiAction } from "../../server/agent/ui-action.ts";

export const Route = createFileRoute("/api/ui-action")({
	server: {
		handlers: ({ createHandlers }) => createHandlers({ POST: uiAction }),
	},
});
