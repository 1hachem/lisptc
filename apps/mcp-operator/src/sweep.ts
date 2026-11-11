import type { McpServer } from "@repo/mcp-extension/kubernetes";
import type { Cluster, Located } from "./cluster.ts";
import {
	EMPTY_SINCE,
	namespaceFor,
	SERVER_LABEL,
	WORKSPACE_LABEL,
} from "./workload.ts";

export const NAMESPACE_IDLE_SECONDS = 24 * 60 * 60;

export interface SweepDeps {
	cluster: Cluster;
	prefix: string;
	servers: readonly McpServer[];
	existing(workspaces: readonly string[]): Promise<ReadonlySet<string>>;
	removeServer(name: string): Promise<void>;
	now: number;
}

function awake(server: McpServer, now: number): boolean {
	const { spec, metadata } = server;
	return (
		metadata.deletionTimestamp === undefined &&
		now - spec.lastUsed < spec.idleSeconds
	);
}

async function orphanPods(
	deps: SweepDeps,
	pods: Located[],
	live: ReadonlySet<string>,
): Promise<void> {
	for (const pod of pods)
		if (!live.has(pod.labels[SERVER_LABEL] ?? ""))
			await deps.cluster.remove(pod.namespace, pod.name);
}

async function goneWorkspaces(
	deps: SweepDeps,
	namespaces: readonly Located[],
): Promise<ReadonlySet<string>> {
	const named = new Set([
		...deps.servers.map((server) => server.spec.workspace),
		...namespaces.flatMap((namespace) => {
			const workspace = namespace.labels[WORKSPACE_LABEL];
			return workspace === undefined ? [] : [workspace];
		}),
	]);
	if (named.size === 0) return new Set();
	const existing = await deps.existing([...named]);
	return new Set([...named].filter((workspace) => !existing.has(workspace)));
}

async function retireServers(
	deps: SweepDeps,
	gone: ReadonlySet<string>,
): Promise<void> {
	for (const server of deps.servers)
		if (
			gone.has(server.spec.workspace) &&
			server.metadata.deletionTimestamp === undefined
		)
			await deps.removeServer(server.metadata.name);
}

async function emptyNamespace(
	deps: SweepDeps,
	namespace: Located,
	inUse: boolean,
): Promise<void> {
	const { cluster, now } = deps;
	const since = Number(namespace.annotations[EMPTY_SINCE]);
	if (inUse) {
		if (since)
			await cluster.annotateNamespace(namespace.name, { [EMPTY_SINCE]: null });
		return;
	}
	if (!since)
		await cluster.annotateNamespace(namespace.name, {
			[EMPTY_SINCE]: String(now),
		});
	else if (now - since >= NAMESPACE_IDLE_SECONDS)
		await cluster.deleteNamespace(namespace.name);
}

export async function sweep(deps: SweepDeps): Promise<void> {
	const { cluster, prefix, servers, now } = deps;
	const ours = <T extends { namespace: string }>(items: T[]) =>
		items.filter((item) => item.namespace.startsWith(prefix));
	const live = new Set(servers.map((server) => server.metadata.name));
	await orphanPods(deps, ours(await cluster.managedPods()), live);
	const namespaces = (await cluster.managedNamespaces()).filter((namespace) =>
		namespace.name.startsWith(prefix),
	);
	const gone = await goneWorkspaces(deps, namespaces);
	await retireServers(deps, gone);
	const inUse = new Set(
		servers
			.filter((server) => !gone.has(server.spec.workspace))
			.filter((server) => awake(server, now))
			.map((server) => namespaceFor(prefix, server.spec.workspace)),
	);
	for (const namespace of namespaces) {
		const workspace = namespace.labels[WORKSPACE_LABEL];
		if (workspace !== undefined && gone.has(workspace))
			await cluster.deleteNamespace(namespace.name);
		else await emptyNamespace(deps, namespace, inUse.has(namespace.name));
	}
}
