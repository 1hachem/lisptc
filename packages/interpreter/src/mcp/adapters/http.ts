/*
 * HTTP deployment adapter: reach a remote MCP server over Streamable HTTP.
 *
 * Purely a reachability adapter — the remote workload belongs to whoever
 * runs it, so there is nothing to provision or deprovision.
 */
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { DeploymentAdapter } from "../adapter.ts";
import type { ConnConfig } from "../protocol.ts";

export const httpAdapter: DeploymentAdapter<null> = {
	provision(): null {
		return null;
	},

	createTransport(conf: ConnConfig): Transport {
		if (!("url" in conf))
			throw new Error(`http adapter requires a url: ${conf.name}`);
		return new StreamableHTTPClientTransport(new URL(conf.url), {
			requestInit: conf.headers ? { headers: conf.headers } : undefined,
		});
	},
};
