import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { createFileRoute } from "@tanstack/react-router";
import { PermissionPage } from "../../../../components/permission-page.tsx";

export const Route = createFileRoute("/_authed/$workspaceId/permissions/$rule")(
	{
		params: {
			parse: ({ rule }: { rule: string }) => ({ rule: Number(rule) }),
			stringify: ({ rule }: { rule: number }) => ({ rule: String(rule) }),
		},
		loader: async ({ context, params }) => {
			if (context.auth.source === "browser") return;
			await context.queryClient.ensureQueryData(
				convexQuery(api.permissions.get, { workspaceId: params.workspaceId }),
			);
		},
		component: PermissionFile,
	},
);

function PermissionFile() {
	const { workspaceId, rule } = Route.useParams();
	return <PermissionPage workspaceId={workspaceId} rule={rule} />;
}
