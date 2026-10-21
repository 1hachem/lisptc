import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { createFileRoute } from "@tanstack/react-router";
import { BinPage } from "../../../../components/bin-page.tsx";

export const Route = createFileRoute("/_authed/$workspaceId/bin/$name")({
	loader: async ({ context, params }) => {
		if (context.auth.source === "browser") return;
		await context.queryClient.ensureQueryData(
			convexQuery(api.bin.get, {
				workspaceId: params.workspaceId,
				name: params.name,
			}),
		);
	},
	component: BinnedFile,
});

function BinnedFile() {
	const { workspaceId, name } = Route.useParams();
	return <BinPage workspaceId={workspaceId} name={name} />;
}
