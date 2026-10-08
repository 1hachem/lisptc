import { createFileRoute } from "@tanstack/react-router";
import { steer, withdraw } from "../../server/agent/chat.ts";

export const Route = createFileRoute("/api/chat/steer")({
	server: {
		handlers: ({ createHandlers }) =>
			createHandlers({ POST: steer, DELETE: withdraw }),
	},
});
