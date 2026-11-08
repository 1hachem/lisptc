import type { McpAction, McpActionResult } from "@repo/backend/mcp-actions";
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
