import { createFileRoute } from "@tanstack/react-router";
import { prefetchPanelAt } from "../../../lib/panel-prefetch.ts";

export const Route = createFileRoute("/_authed/$workspaceId/$")({
	loader: async ({ context, params }) => {
		if (context.auth.source === "browser") return;
		await prefetchPanelAt(
			context.queryClient,
			params.workspaceId,
			params._splat ?? "",
		);
	},
	component: () => null,
});
