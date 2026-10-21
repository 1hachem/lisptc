import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../../../components/settings-page.tsx";

export const Route = createFileRoute("/_authed/$workspaceId/settings")({
	loader: async ({ context, params }) => {
		if (context.auth.source === "browser") return;
		await context.queryClient.ensureQueryData(
			convexQuery(api.workspaces.get, { workspaceId: params.workspaceId }),
		);
	},
	component: SettingsFile,
});

function SettingsFile() {
	const { workspaceId } = Route.useParams();
	return <SettingsPage workspaceId={workspaceId} />;
}
