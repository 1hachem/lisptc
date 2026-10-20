import { createFileRoute } from "@tanstack/react-router";
import { symbols } from "../../server/agent/symbols.ts";

export const Route = createFileRoute("/api/symbols")({
	server: {
		handlers: ({ createHandlers }) => createHandlers({ POST: symbols }),
	},
});
