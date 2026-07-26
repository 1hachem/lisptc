/*
 * Deployment adapters: how an MCP server is provisioned and reached.
 *
 * Two lifecycles are deliberately kept separate:
 *
 *   workload   provision() -> handle ........ deprovision(handle)
 *   connection createTransport(conf, handle) -> Transport (closed by Client)
 *
 * `provision` acquires or locates the workload (spawn nothing for stdio,
 * ensure a pod for k8s, start a container for docker) and returns an opaque
 * handle describing what was acquired. `createTransport` only establishes
 * reachability to that workload; the SDK `Client` owns the connection from
 * there (listTools/callTool are uniform over any Transport, and
 * `Client.close()` tears the transport down). `deprovision` releases
 * exactly what `provision` acquired — the broker calls it on disconnect,
 * after closing the client, so unloading a server also reaps any workload
 * that was created for it.
 *
 * Register new deployment targets with `registerAdapter("k8s", {...})` and
 * select them per server with `deploy: "k8s"` in the connection config.
 */
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ConnConfig } from "./protocol.ts";

export interface DeploymentAdapter<H = unknown> {
	// Acquire or locate the workload for the described server. Whatever this
	// returns is stored by the broker and handed back to createTransport and
	// deprovision. Adapters that manage no workload return null.
	provision(conf: ConnConfig): H | Promise<H>;

	// Establish reachability to the provisioned workload and return a
	// transport for it. Called after provision; must not acquire anything
	// deprovision would not release.
	createTransport(conf: ConnConfig, handle: H): Transport | Promise<Transport>;

	// Release what provision acquired (delete the pod, stop the container).
	// Called on disconnect, after the client (and its transport) is closed.
	// Omit when provision acquires nothing.
	deprovision?(handle: H): void | Promise<void>;
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
