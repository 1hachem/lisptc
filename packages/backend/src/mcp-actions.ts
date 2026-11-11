import { oauthKey, offersLogin } from "@repo/mcp-extension/ports";
import { bundledToolkit } from "@repo/mcp-extension/toolkit";
import type { AgentRepl } from "@repo/repl/repl";

export const MCP_ACTIONS = ["start", "remove", "login", "logout"] as const;

export type McpAction = (typeof MCP_ACTIONS)[number];

export const MCP_SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export type McpScope = "workspace" | "dedicated";

const FORMS: Record<McpAction, (server: string, scope: McpScope) => string> = {
	start: (server, scope) =>
		scope === "dedicated"
			? `(load-mcp "${server}" :dedicated t)`
			: `(load-mcp "${server}")`,
	remove: (server) => `(remove-mcp "${server}")`,
	login: (server) => `(login "${server}" :url t)`,
	logout: (server) => `(logout "${server}")`,
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
	scope: McpScope = "workspace",
): Promise<McpActionResult> {
	if (!MCP_SERVER_NAME.test(server))
		return { error: `not a server name: ${server}` };
	const out = await repl.evalOutput(FORMS[action](server, scope));
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
	loginKey?: string;
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
			...(offersLogin(conf)
				? { loginKey: oauthKey(conf, "url" in conf ? conf.url : "") }
				: {}),
		}))
		.sort((a, b) => a.server.localeCompare(b.server));
}
