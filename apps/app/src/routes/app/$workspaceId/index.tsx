import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/app/$workspaceId/")({
	component: () => null,
});
