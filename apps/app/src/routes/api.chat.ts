import { createFileRoute } from "@tanstack/react-router";
import { turn } from "../../server/agent/chat.ts";

export const Route = createFileRoute("/api/chat")({
	server: { handlers: ({ createHandlers }) => createHandlers({ POST: turn }) },
});
