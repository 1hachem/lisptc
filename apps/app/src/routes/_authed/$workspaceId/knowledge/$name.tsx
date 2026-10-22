import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { StoredFile } from "../../../../components/stored-file.tsx";

export const Route = createFileRoute("/_authed/$workspaceId/knowledge/$name")({
	loader: async ({ context, params }) => {
		if (context.auth.source === "browser") return;
		await context.queryClient.ensureQueryData(
			convexQuery(api.files.get, {
				workspaceId: params.workspaceId,
				folder: "knowledge",
				name: params.name,
			}),
		);
	},
	component: KnowledgeFile,
});

function KnowledgeFile() {
	const { workspaceId, name } = Route.useParams();
	const { data: file, error } = useQuery(
		convexQuery(api.files.get, { workspaceId, folder: "knowledge", name }),
	);
	if (error) throw error;
	return <StoredFile folder="knowledge" name={name} file={file} />;
}
