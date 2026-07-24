/*
 * HTTP deployment adapter: reach a remote MCP server over Streamable HTTP.
 */
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { DeploymentAdapter } from "../adapter.ts";
import type { ConnConfig } from "../protocol.ts";

export const httpAdapter: DeploymentAdapter = {
	createTransport(conf: ConnConfig): Transport {
		if (!("url" in conf))
			throw new Error(`http adapter requires a url: ${conf.name}`);
		return new StreamableHTTPClientTransport(new URL(conf.url), {
			requestInit: conf.headers ? { headers: conf.headers } : undefined,
		});
	},
};
