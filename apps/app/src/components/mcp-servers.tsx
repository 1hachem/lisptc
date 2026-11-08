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

type LoadedChip = McpServerChip & {
	phase: Exclude<McpServerChip["phase"], "sleeping">;
};

const DOT: Record<LoadedChip["phase"], string> = {
	starting: "bg-yellow animate-pulse",
	ready: "bg-green",
	failed: "bg-red",
};

export function McpServerChips({
	servers,
	chatId = null,
}: {
	servers: McpServerChip[];
	chatId?: string | null;
}) {
	const sorted = servers
		.filter(({ instance }) => instance === undefined || instance === chatId)
		.filter((chip): chip is LoadedChip => chip.phase !== "sleeping")
		.sort((a, b) => a.server.localeCompare(b.server));
	if (sorted.length === 0) return null;
	return (
		<ul
			aria-label="MCP servers"
			className="mx-auto mb-1 flex w-full max-w-[680px] flex-wrap gap-x-3 gap-y-1 px-3 text-[11px] text-dim"
		>
			{sorted.map(({ server, instance, phase, reason }) => (
				<li
					key={`${server}\0${instance ?? ""}`}
					title={reason ? `${phase}: ${reason}` : phase}
					className="flex items-center gap-1.5"
				>
					<span
						aria-hidden
						className={cn("size-1.5 flex-none rounded-full", DOT[phase])}
					/>
					<span>{instance ? `${server} (own)` : server}</span>
					<span className="sr-only">{phase}</span>
				</li>
			))}
		</ul>
	);
}

function WorkspaceMcpServers({
	workspaceId,
	chatId,
}: {
	workspaceId: Id<"workspaces">;
	chatId: string | null;
}) {
	const { data } = useQuery(convexQuery(api.mcpServers.list, { workspaceId }));
	return <McpServerChips servers={data?.servers ?? []} chatId={chatId} />;
}

export function McpServers({ chatId }: { chatId: string | null }) {
	const { workspace } = useWorkspace();
	return workspace ? (
		<WorkspaceMcpServers workspaceId={workspace._id} chatId={chatId} />
	) : null;
}
