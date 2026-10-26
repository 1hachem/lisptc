import type { V1DaemonSet } from "@kubernetes/client-node";
import { imagesOf } from "@repo/mcp-extension/kubernetes";
import type { ConnConfig } from "@repo/mcp-extension/ports";
import toolkit from "@repo/toolkit/mcp.toolkit.json" with { type: "json" };
import type { Cluster } from "./cluster.ts";
import { pullStalled } from "./state.ts";
import { PREPULL_SELECTOR, repositoryOf } from "./workload.ts";

export function toolkitImages(
	tag?: string,
	entries: readonly unknown[] = toolkit,
): string[] {
	return [
		...new Set(
			(entries as ConnConfig[]).flatMap((conf) => imagesOf(conf, tag)),
		),
	];
}

export function ownRepositories(
	entries: readonly unknown[] = toolkit,
): string[] {
	return (entries as ConnConfig[]).flatMap((conf) =>
		"image" in conf && conf.internal ? [repositoryOf(conf.image)] : [],
	);
}

export async function prepull(
	cluster: Cluster,
	namespace: string,
	sets: V1DaemonSet[],
): Promise<void> {
	const wanted = new Set(sets.map((set) => set.metadata?.name ?? ""));
	const stale = (await cluster.daemonSets(namespace, PREPULL_SELECTOR)).filter(
		(name) => !wanted.has(name),
	);
	const results = await Promise.allSettled([
		...sets.map((set) => cluster.ensureDaemonSet(namespace, set)),
		...stale.map((name) => cluster.deleteDaemonSet(namespace, name)),
	]);
	const failures = results.flatMap((result) =>
		result.status === "rejected" ? [result.reason] : [],
	);
	if (failures.length)
		throw new AggregateError(
			failures,
			failures
				.map((ex) => (ex instanceof Error ? ex.message : String(ex)))
				.join("; "),
		);
}

export async function retryStalledPulls(
	cluster: Cluster,
	namespace: string,
): Promise<string[]> {
	const stalled = (await cluster.pods(namespace, PREPULL_SELECTOR))
		.filter(pullStalled)
		.map((pod) => pod.metadata?.name ?? "");
	await Promise.all(stalled.map((name) => cluster.removePod(namespace, name)));
	return stalled;
}
