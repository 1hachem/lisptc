import {
	type McpAction,
	type McpActionResult,
	type ToolkitEntry,
	toolkitEntries,
} from "@repo/backend/mcp-actions";
import { queryOptions } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { apiHeaders } from "./api.ts";

export async function postMcpAction(
	workspaceId: string,
	server: string,
	action: McpAction,
): Promise<McpActionResult> {
	const res = await fetch("/api/mcp/action", {
		method: "POST",
		headers: await apiHeaders(),
		body: JSON.stringify({ workspaceId, server, action }),
	});
	return (await res.json()) as McpActionResult;
}

async function fetchToolkit(): Promise<ToolkitEntry[]> {
	const res = await fetch("/api/mcp/toolkit", {
		method: "POST",
		headers: await apiHeaders(),
		body: "{}",
	});
	if (!res.ok) throw new Error(`toolkit: ${res.status}`);
	return (await res.json()) as ToolkitEntry[];
}

const loadToolkit = createIsomorphicFn()
	.server(async (): Promise<ToolkitEntry[]> => toolkitEntries())
	.client(fetchToolkit);

export function toolkitQuery() {
	return queryOptions({
		queryKey: ["mcp-toolkit"],
		queryFn: () => loadToolkit(),
		staleTime: Number.POSITIVE_INFINITY,
	});
}
