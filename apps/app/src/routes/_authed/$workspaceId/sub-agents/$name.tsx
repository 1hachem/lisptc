import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FileView } from "../../../../components/file-view.tsx";
import { agentSource } from "../../../../lib/files.ts";

export const Route = createFileRoute("/_authed/$workspaceId/sub-agents/$name")({
	loader: async ({ context, params }) => {
		if (context.auth.source === "browser") return;
		await context.queryClient.ensureQueryData(
			convexQuery(api.agents.list, { workspaceId: params.workspaceId }),
		);
	},
	component: AgentFile,
});

function AgentFile() {
	const { workspaceId, name } = Route.useParams();
	const { data: agents, error } = useQuery(
		convexQuery(api.agents.list, { workspaceId }),
	);
	if (error) throw error;
	const agent = agents?.find((candidate) => candidate.name === name);

	return (
		<FileView
			file={agent && { path: `sub-agents/${name}`, source: agentSource(agent) }}
			missing={agents === undefined ? undefined : `no agent named ${name}`}
		/>
	);
}
