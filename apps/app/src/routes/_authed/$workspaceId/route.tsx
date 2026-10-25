import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { PanelSplit } from "../../../components/panel-split.tsx";
import { prefetchPanels } from "../../../lib/panel-prefetch.ts";
import { PanelsProvider } from "../../../lib/panels.tsx";
import { prefetchSidebar } from "../../../lib/sidebar-prefetch.ts";

export const Route = createFileRoute("/_authed/$workspaceId")({
	params: {
		parse: ({ workspaceId }: { workspaceId: string }) => ({
			workspaceId: workspaceId as Id<"workspaces">,
		}),
		stringify: ({ workspaceId }: { workspaceId: Id<"workspaces"> }) => ({
			workspaceId,
		}),
	},
	loader: async ({ context, params }) => {
		if (context.auth.source === "browser") return;
		const workspaces = await context.queryClient.ensureQueryData(
			convexQuery(api.workspaces.list, {}),
		);
		if (workspaces.every((workspace) => workspace._id !== params.workspaceId))
			throw notFound();
		await Promise.all([
			prefetchPanels(context.queryClient, params.workspaceId),
			prefetchSidebar(context.queryClient, params.workspaceId),
		]);
	},
	component: WorkspaceLayout,
});

function WorkspaceLayout() {
	const { workspaceId } = Route.useParams();
	return (
		<PanelsProvider workspaceId={workspaceId}>
			<PanelSplit />
			<Outlet />
		</PanelsProvider>
	);
}
