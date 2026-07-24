/*
 * Deployment adapters: how an MCP server is provisioned/reached.
 *
 * The MCP SDK's `Client` already unifies listTools/callTool over any
 * `Transport`, so the only thing that differs between "spawn a subprocess",
 * "talk to an HTTP endpoint", "exec into a Docker container" or "port-forward
 * to a Kubernetes pod" is how the transport is created. An adapter captures
 * exactly that. Adapters run on the broker side (inside the worker), where
 * async SDK work is allowed.
 *
 * Register new deployment targets with `registerAdapter("k8s", {...})` and
 * select them per server with `deploy: "k8s"` in the connection config.
 */
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ConnConfig } from "./protocol.ts";

export interface DeploymentAdapter {
	// Provision (if needed) and return a transport for the described server.
	// The caller connects an SDK Client over it; `Client.close()` tears the
	// transport down, so adapters normally need no extra cleanup hook.
	createTransport(conf: ConnConfig): Transport | Promise<Transport>;
}

const registry = new Map<string, DeploymentAdapter>();

export function registerAdapter(kind: string, adapter: DeploymentAdapter) {
	registry.set(kind, adapter);
}

export function resolveAdapter(conf: ConnConfig): DeploymentAdapter {
	const kind = conf.deploy ?? ("url" in conf ? "http" : "stdio");
	const adapter = registry.get(kind);
	if (!adapter) throw new Error(`unknown deployment adapter: ${kind}`);
	return adapter;
}
