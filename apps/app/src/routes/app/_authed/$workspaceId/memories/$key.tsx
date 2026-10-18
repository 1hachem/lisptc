import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FileView } from "../../../../../components/file-view.tsx";
import { memorySource } from "../../../../../lib/files.ts";

export const Route = createFileRoute("/app/_authed/$workspaceId/memories/$key")(
	{
		loader: async ({ context, params }) => {
			if (context.auth.source === "browser") return;
			await context.queryClient.ensureQueryData(
				convexQuery(api.memories.list, { workspaceId: params.workspaceId }),
			);
		},
		component: MemoryFile,
	},
);

function MemoryFile() {
	const { workspaceId, key } = Route.useParams();
	const { data: memories, error } = useQuery(
		convexQuery(api.memories.list, { workspaceId }),
	);
	if (error) throw error;
	const memory = memories?.find((candidate) => candidate.key === key);

	return (
		<FileView
			file={memory && { path: `memories/${key}`, source: memorySource(memory) }}
			missing={memories === undefined ? undefined : `no memory named ${key}`}
		/>
	);
}
