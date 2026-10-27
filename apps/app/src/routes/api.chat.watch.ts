import { createFileRoute } from "@tanstack/react-router";
import { watch } from "../../server/agent/chat.ts";

export const Route = createFileRoute("/api/chat/watch")({
	server: { handlers: ({ createHandlers }) => createHandlers({ GET: watch }) },
});
