import type { ConnConfig } from "./ports.ts";

export interface Launch {
	image: string;
	exposed: string;
	path: string;
	args: string[];
}

const GATEWAY_IMAGE = "supercorp/supergateway:3.4.3";
const GATEWAY_PORT = "8000";
const MCP_PATH = "/mcp";

function shellQuote(word: string): string {
	return /^[\w@%+=:,./-]+$/.test(word)
		? word
		: `'${word.replaceAll("'", `'\\''`)}'`;
}

function stdioCommand(conf: ConnConfig): string {
	const command = "command" in conf ? conf.command : undefined;
	if (command === undefined) return "";
	return [command, ...(conf.args ?? [])].map(shellQuote).join(" ");
}

export function launchFor(conf: ConnConfig): Launch | undefined {
	if ("image" in conf)
		return {
			image: conf.image,
			exposed: String(conf.port),
			path: conf.path ?? MCP_PATH,
			args: conf.command ? [] : (conf.args ?? []),
		};
	if ("url" in conf) return undefined;
	return {
		image: GATEWAY_IMAGE,
		exposed: GATEWAY_PORT,
		path: MCP_PATH,
		args: [
			"--stdio",
			stdioCommand(conf),
			"--outputTransport",
			"streamableHttp",
			"--stateful",
			"--port",
			GATEWAY_PORT,
			"--streamableHttpPath",
			MCP_PATH,
		],
	};
}
