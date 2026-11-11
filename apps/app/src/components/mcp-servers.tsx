import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { cn } from "@repo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";

type McpServerRow = FunctionReturnType<
	typeof api.mcpServers.list
>["servers"][number];

export type McpPhase = McpServerRow["phase"];

const PHASE_DOT: Record<McpPhase, string> = {
	starting: "bg-yellow animate-pulse",
	ready: "bg-green",
	sleeping: "bg-dim",
	failed: "bg-red",
};

export type McpCatalogRow = FunctionReturnType<
	typeof api.mcpServers.catalog
>[number];

export interface McpToolSummary {
	name: string;
	description?: string;
}

export interface WorkspaceMcpServer {
	server: string;
	phase?: McpPhase;
	reason?: string;
	mounted: boolean;
	description?: string;
	icon?: string;
	login: boolean;
	tools: McpToolSummary[];
	fetchedAt?: number;
}

function toolsOf(json: string | undefined): McpToolSummary[] {
	if (json === undefined) return [];
	const parsed: unknown = JSON.parse(json);
	if (!Array.isArray(parsed)) return [];
	return parsed.flatMap((tool: { name?: unknown; description?: unknown }) =>
		typeof tool?.name === "string"
			? [
					{
						name: tool.name,
						...(typeof tool.description === "string"
							? { description: tool.description }
							: {}),
					},
				]
			: [],
	);
}

export function workspaceServers(
	servers: readonly McpServerRow[],
	mounted: readonly string[],
	catalog: readonly McpCatalogRow[],
): WorkspaceMcpServer[] {
	const status = new Map(servers.map((row) => [row.server, row]));
	const known = new Map(catalog.map((row) => [row.server, row]));
	const names = [
		...new Set([...mounted, ...status.keys(), ...known.keys()]),
	].sort();
	return names.map((server) => {
		const row = status.get(server);
		const info = known.get(server);
		return {
			server,
			...(row === undefined ? {} : { phase: row.phase }),
			...(row?.reason === undefined ? {} : { reason: row.reason }),
			mounted: mounted.includes(server),
			...(info?.description === undefined
				? {}
				: { description: info.description }),
			...(info?.icon === undefined ? {} : { icon: info.icon }),
			login: info?.login === true,
			tools: toolsOf(info?.tools),
			...(info === undefined ? {} : { fetchedAt: info.fetchedAt }),
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
	const { data: catalog } = useQuery(
		convexQuery(api.mcpServers.catalog, { workspaceId }),
	);
	if (status === undefined || mounts === undefined || catalog === undefined)
		return undefined;
	return workspaceServers(
		status.servers,
		mounts.map(({ server }) => server),
		catalog,
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
