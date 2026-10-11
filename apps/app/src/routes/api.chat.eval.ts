import { createFileRoute } from "@tanstack/react-router";
import { evaluate } from "../../server/agent/chat.ts";

export const Route = createFileRoute("/api/chat/eval")({
	server: {
		handlers: ({ createHandlers }) => createHandlers({ POST: evaluate }),
	},
});
