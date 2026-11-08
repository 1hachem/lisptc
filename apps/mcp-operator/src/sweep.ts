import type { Cluster, Located } from "./cluster.ts";
import type { StatusSink } from "./status-sink.ts";
import {
	claimOwner,
	EMPTY_SINCE,
	RELEASED_AT,
	RETENTION,
	SERVER_LABEL,
	STATE_LABEL,
	STATE_PATH,
} from "./workload.ts";

export const NAMESPACE_IDLE_SECONDS = 1800;

export interface SweepDeps {
	cluster: Cluster;
	sink: StatusSink;
	prefix: string;
	live: Set<string>;
	liveNamespaces: Set<string>;
	now: number;
}

function expired(claim: Located, now: number): boolean {
	const released = Number(claim.annotations[RELEASED_AT]);
	const retention = Number(claim.annotations[RETENTION]);
	if (!released || Number.isNaN(retention)) return false;
	return now - released >= retention;
}

async function orphanPods(deps: SweepDeps, pods: Located[]): Promise<void> {
	for (const pod of pods)
		if (!deps.live.has(pod.labels[SERVER_LABEL] ?? ""))
			await deps.cluster.remove(pod.namespace, pod.name);
}

async function expiredClaims(
	deps: SweepDeps,
	claims: Located[],
): Promise<void> {
	for (const claim of claims.filter((each) => expired(each, deps.now))) {
		await deps.cluster.deleteClaim(claim.namespace, claim.name);
		await deps.sink.observeState({
			...claimOwner(claim.annotations),
			name: claim.labels[STATE_LABEL] ?? "",
			path: claim.annotations[STATE_PATH] ?? "",
			size: "",
			phase: "gone",
		});
	}
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
	const claims = ours(await deps.cluster.managedClaims());
	await expiredClaims(deps, claims);
	const holding = new Set(claims.map((claim) => claim.namespace));
	for (const namespace of await deps.cluster.managedNamespaces())
		if (namespace.name.startsWith(deps.prefix))
			await emptyNamespace(
				deps,
				namespace,
				deps.liveNamespaces.has(namespace.name) || holding.has(namespace.name),
			);
}
