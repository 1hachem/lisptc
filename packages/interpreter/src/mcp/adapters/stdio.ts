/*
 * Stdio deployment adapter: spawn the MCP server as a local subprocess and
 * speak the protocol over its stdin/stdout.
 */
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { DeploymentAdapter } from "../adapter.ts";
import type { ConnConfig } from "../protocol.ts";

export const stdioAdapter: DeploymentAdapter = {
	createTransport(conf: ConnConfig): Transport {
		if (!("command" in conf))
			throw new Error(`stdio adapter requires a command: ${conf.name}`);
		return new StdioClientTransport({
			command: conf.command,
			args: conf.args ?? [],
			// Inherit env so PATH etc. resolve; merge any explicit overrides.
			env: {
				...(process.env as Record<string, string>),
				...(conf.env ?? {}),
			},
		});
	},
};
