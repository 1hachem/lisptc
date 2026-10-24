import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { agentSource } from "../lib/files.ts";
import { FileView } from "./file-view.tsx";

export function AgentPage({
	workspaceId,
	name,
}: {
	workspaceId: Id<"workspaces">;
	name: string;
}) {
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
