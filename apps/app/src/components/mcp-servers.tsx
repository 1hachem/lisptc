import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { cn } from "@repo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { useWorkspace } from "../lib/workspace.tsx";

export type McpServerChip = FunctionReturnType<
	typeof api.mcpServers.list
>["servers"][number];

const DOT: Record<McpServerChip["phase"], string> = {
	starting: "bg-yellow animate-pulse",
	ready: "bg-green",
	sleeping: "bg-dim",
	failed: "bg-red",
};

export function McpServerChips({ servers }: { servers: McpServerChip[] }) {
	if (servers.length === 0) return null;
	const sorted = [...servers].sort((a, b) => a.server.localeCompare(b.server));
	return (
		<ul
			aria-label="MCP servers"
			className="mx-auto mb-1 flex w-full max-w-[680px] flex-wrap gap-x-3 gap-y-1 px-3 text-[11px] text-dim"
		>
			{sorted.map(({ server, phase, reason }) => (
				<li
					key={server}
					title={reason ? `${phase}: ${reason}` : phase}
					className="flex items-center gap-1.5"
				>
					<span
						aria-hidden
						className={cn("size-1.5 flex-none rounded-full", DOT[phase])}
					/>
					<span>{server}</span>
					<span className="sr-only">{phase}</span>
				</li>
			))}
		</ul>
	);
}

function WorkspaceMcpServers({
	workspaceId,
}: {
	workspaceId: Id<"workspaces">;
}) {
	const { data } = useQuery(convexQuery(api.mcpServers.list, { workspaceId }));
	return <McpServerChips servers={data?.servers ?? []} />;
}

export function McpServers() {
	const { workspace } = useWorkspace();
	return workspace ? <WorkspaceMcpServers workspaceId={workspace._id} /> : null;
}
