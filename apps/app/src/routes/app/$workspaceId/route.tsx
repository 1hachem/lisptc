import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import {
	createFileRoute,
	notFound,
	Outlet,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { AppLoading } from "../../../components/app-loading.tsx";
import { PanelSplit } from "../../../components/panel-split.tsx";
import { prefetchPanels } from "../../../lib/panel-prefetch.ts";
import { PanelsProvider } from "../../../lib/panels.tsx";
import { preferencesQuery } from "../../../lib/preferences.ts";
import { prefetchSidebar } from "../../../lib/sidebar-prefetch.ts";
import { useWorkspace } from "../../../lib/workspace.tsx";

export const Route = createFileRoute("/app/$workspaceId")({
	params: {
		parse: ({ workspaceId }: { workspaceId: string }) => ({
			workspaceId: workspaceId as Id<"workspaces">,
		}),
		stringify: ({ workspaceId }: { workspaceId: Id<"workspaces"> }) => ({
			workspaceId,
		}),
	},
	loader: async ({ context, params }) => {
		if (context.auth.source === "browser")
			return prefetchPanels(context.queryClient, params.workspaceId);
		const prefetched = Promise.allSettled([
			prefetchPanels(context.queryClient, params.workspaceId),
			prefetchSidebar(context.queryClient, params.workspaceId),
			context.queryClient.ensureQueryData(preferencesQuery(params.workspaceId)),
		]);
		const workspaces = await context.queryClient.ensureQueryData(
			convexQuery(api.workspaces.list, {}),
		);
		if (workspaces.every((workspace) => workspace._id !== params.workspaceId)) {
			const [landing] = workspaces;
			if (landing === undefined) throw notFound();
			throw redirect({
				to: "/app/$workspaceId",
				params: { workspaceId: landing._id },
				replace: true,
			});
		}
		for (const outcome of await prefetched)
			if (outcome.status === "rejected") throw outcome.reason;
	},
	pendingComponent: AppLoading,
	component: WorkspaceLayout,
});

function WorkspaceLayout() {
	const { workspaceId } = Route.useParams();
	const navigate = useNavigate();
	const { workspace } = useWorkspace();
	const landing =
		workspace !== null && workspace._id !== workspaceId ? workspace._id : null;

	useEffect(() => {
		if (landing === null) return;
		void navigate({
			to: "/app/$workspaceId",
			params: { workspaceId: landing },
			replace: true,
		});
	}, [landing, navigate]);

	if (landing !== null) return <AppLoading />;
	return (
		<PanelsProvider workspaceId={workspaceId}>
			<PanelSplit />
			<Outlet />
		</PanelsProvider>
	);
}
