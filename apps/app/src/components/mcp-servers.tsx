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

export type McpPhase = McpServerChip["phase"];

export const PHASE_DOT: Record<McpPhase, string> = {
	starting: "bg-yellow animate-pulse",
	ready: "bg-green",
	sleeping: "bg-dim",
	failed: "bg-red",
};

export interface WorkspaceMcpServer {
	server: string;
	phase?: McpPhase;
	reason?: string;
	mounted: boolean;
}

export function workspaceServers(
	servers: readonly McpServerChip[],
	mounted: readonly string[],
): WorkspaceMcpServer[] {
	const shared = new Map(
		servers
			.filter(({ instance }) => instance === undefined)
			.map((row) => [row.server, row]),
	);
	const names = [...new Set([...mounted, ...shared.keys()])].sort();
	return names.map((server) => {
		const row = shared.get(server);
		return {
			server,
			...(row === undefined ? {} : { phase: row.phase }),
			...(row?.reason === undefined ? {} : { reason: row.reason }),
			mounted: mounted.includes(server),
		};
	});
}

export function useWorkspaceMcpServers(
	workspaceId: Id<"workspaces">,
): WorkspaceMcpServer[] | undefined {
	const { data: status } = useQuery(
		convexQuery(api.mcpServers.list, { workspaceId }),
	);
	const { data: mounts } = useQuery(
		convexQuery(api.mcpServers.mounts, { workspaceId }),
	);
	if (status === undefined || mounts === undefined) return undefined;
	return workspaceServers(
		status.servers,
		mounts.map(({ server }) => server),
	);
}

export function PhaseDot({ phase }: { phase: McpPhase | undefined }) {
	return (
		<span
			aria-hidden
			className={cn(
				"size-1.5 flex-none rounded-full",
				phase === undefined ? "bg-dim/40" : PHASE_DOT[phase],
			)}
		/>
	);
}

export function McpServerChips({
	servers,
	chatId,
}: {
	servers: McpServerChip[];
	chatId: string | null;
}) {
	const own = servers
		.filter(({ instance }) => instance !== undefined && instance === chatId)
		.filter(({ phase }) => phase !== "sleeping")
		.sort((a, b) => a.server.localeCompare(b.server));
	if (own.length === 0) return null;
	return (
		<ul
			aria-label="MCP servers of this chat"
			className="mx-auto mb-1 flex w-full max-w-[680px] flex-wrap gap-x-3 gap-y-1 px-3 text-[11px] text-dim"
		>
			{own.map(({ server, phase, reason }) => (
				<li
					key={server}
					title={reason ? `${phase}: ${reason}` : phase}
					className="flex items-center gap-1.5"
				>
					<PhaseDot phase={phase} />
					<span>{server}</span>
					<span className="sr-only">{phase}</span>
				</li>
			))}
		</ul>
	);
}

function ChatMcpServers({
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
	return workspace && chatId !== null ? (
		<ChatMcpServers workspaceId={workspace._id} chatId={chatId} />
	) : null;
}
