import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { createFileRoute } from "@tanstack/react-router";
import { MemoryPage } from "../../../../components/memory-page.tsx";

export const Route = createFileRoute("/_authed/$workspaceId/memories/$key")({
	loader: async ({ context, params }) => {
		if (context.auth.source === "browser") return;
		await context.queryClient.ensureQueryData(
			convexQuery(api.memories.list, { workspaceId: params.workspaceId }),
		);
	},
	component: MemoryFile,
});

function MemoryFile() {
	const { workspaceId, key } = Route.useParams();
	return <MemoryPage workspaceId={workspaceId} memoryKey={key} />;
}
