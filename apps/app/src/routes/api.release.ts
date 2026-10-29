import { createFileRoute } from "@tanstack/react-router";
import { serveDesktopRelease } from "../../server/desktop/release.ts";

export const Route = createFileRoute("/api/release")({
	server: {
		handlers: ({ createHandlers }) =>
			createHandlers({ GET: serveDesktopRelease }),
	},
});
