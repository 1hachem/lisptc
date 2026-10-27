import { createFileRoute } from "@tanstack/react-router";
import { stop } from "../../server/agent/chat.ts";

export const Route = createFileRoute("/api/chat/stop")({
	server: { handlers: ({ createHandlers }) => createHandlers({ POST: stop }) },
});
