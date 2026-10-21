import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { createFileRoute } from "@tanstack/react-router";
import { ReadmePage } from "../../../components/readme-page.tsx";

export const Route = createFileRoute("/_authed/$workspaceId/readme")({
	loader: async ({ context, params }) => {
		await context.queryClient.ensureQueryData(
			convexQuery(api.readmes.get, { workspaceId: params.workspaceId }),
		);
	},
	component: ReadmeFile,
});

function ReadmeFile() {
	const { workspaceId } = Route.useParams();
	return <ReadmePage workspaceId={workspaceId} />;
}
