/*
 * Stdio deployment adapter: the MCP server runs as a local subprocess and
 * speaks the protocol over its stdin/stdout.
 *
 * There is nothing to provision: the subprocess is spawned by the transport
 * itself and dies with it when the client closes.
 */
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { DeploymentAdapter } from "../adapter.ts";
import type { ConnConfig } from "../protocol.ts";

export const stdioAdapter: DeploymentAdapter<null> = {
	provision(): null {
		return null;
	},

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
