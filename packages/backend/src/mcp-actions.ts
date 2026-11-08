import { offersLogin } from "@repo/mcp-extension/ports";
import { bundledToolkit } from "@repo/mcp-extension/toolkit";
import type { AgentRepl } from "@repo/repl/repl";

export const MCP_ACTIONS = ["start", "remove", "login"] as const;

export type McpAction = (typeof MCP_ACTIONS)[number];

export const MCP_SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

const FORMS: Record<McpAction, (server: string) => string> = {
	start: (server) => `(load-mcp "${server}")`,
	remove: (server) => `(remove-mcp "${server}")`,
	login: (server) => `(login "${server}" :url t)`,
};

export type McpActionResult = { ok: true; url?: string } | { error: string };

function urlIn(results: readonly string[]): string | undefined {
	const last = results.at(-1);
	if (last === undefined || !last.startsWith('"')) return undefined;
	const text = JSON.parse(last) as string;
	return URL.canParse(text) ? text : undefined;
}

export async function runMcpAction(
	repl: AgentRepl,
	server: string,
	action: McpAction,
): Promise<McpActionResult> {
	if (!MCP_SERVER_NAME.test(server))
		return { error: `not a server name: ${server}` };
	const out = await repl.evalOutput(FORMS[action](server));
	if (out.failed || out.held)
		return { error: out.failure ?? out.message ?? `${action} did not finish` };
	const url = action === "login" ? urlIn(out.results) : undefined;
	return { ok: true, ...(url === undefined ? {} : { url }) };
}

export interface ToolkitEntry {
	server: string;
	description?: string;
	icon?: string;
	login: boolean;
}

export function toolkitEntries(): ToolkitEntry[] {
	return bundledToolkit()
		.all()
		.map((conf) => ({
			server: conf.name,
			...(conf.description === undefined
				? {}
				: { description: conf.description }),
			...(conf.icon === undefined ? {} : { icon: conf.icon }),
			login: offersLogin(conf),
		}))
		.sort((a, b) => a.server.localeCompare(b.server));
}
