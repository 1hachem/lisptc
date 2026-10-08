import { createFileRoute } from "@tanstack/react-router";
import { oauthCallback } from "../../server/agent/oauth-callback.ts";

export const Route = createFileRoute("/api/oauth/callback")({
	server: {
		handlers: ({ createHandlers }) => createHandlers({ POST: oauthCallback }),
	},
});
