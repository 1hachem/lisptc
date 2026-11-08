import type { Cluster, Located } from "./cluster.ts";
import { EMPTY_SINCE, SERVER_LABEL } from "./workload.ts";

export const NAMESPACE_IDLE_SECONDS = 1800;

export interface SweepDeps {
	cluster: Cluster;
	prefix: string;
	live: Set<string>;
	liveNamespaces: Set<string>;
	now: number;
}

async function orphanPods(deps: SweepDeps, pods: Located[]): Promise<void> {
	for (const pod of pods)
		if (!deps.live.has(pod.labels[SERVER_LABEL] ?? ""))
			await deps.cluster.remove(pod.namespace, pod.name);
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
	const ours = <T extends { namespace: string }>(items: T[]) =>
		items.filter((item) => item.namespace.startsWith(deps.prefix));
	await orphanPods(deps, ours(await deps.cluster.managedPods()));
	for (const namespace of await deps.cluster.managedNamespaces())
		if (namespace.name.startsWith(deps.prefix))
			await emptyNamespace(
				deps,
				namespace,
				deps.liveNamespaces.has(namespace.name),
			);
}
