import type {
	McpAction,
	McpActionResult,
	ToolkitEntry,
} from "@repo/backend/mcp-actions";
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

export async function fetchToolkit(
	workspaceId: string,
): Promise<ToolkitEntry[]> {
	const res = await fetch("/api/mcp/toolkit", {
		method: "POST",
		headers: await apiHeaders(),
		body: JSON.stringify({ workspaceId }),
	});
	if (!res.ok) throw new Error(`toolkit: ${res.status}`);
	return (await res.json()) as ToolkitEntry[];
}
