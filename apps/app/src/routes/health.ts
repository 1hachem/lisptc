import { createFileRoute } from "@tanstack/react-router";
import { health } from "../../server/agent/health.ts";

export const Route = createFileRoute("/health")({
	server: {
		handlers: ({ createHandlers }) => createHandlers({ GET: health }),
	},
});
