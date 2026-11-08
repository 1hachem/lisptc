import type { V1Pod } from "@kubernetes/client-node";
import {
	type McpServer,
	type McpServerStatus,
	type ServerPhase,
	workloadHash,
} from "@repo/mcp-extension/kubernetes";
import type { Cluster, Servers } from "./cluster.ts";
import { stateOf } from "./state.ts";
import type { StatusSink } from "./status-sink.ts";
import {
	egressPolicy,
	endpointsFor,
	ingressPolicy,
	namespaceFor,
	namespaceManifest,
	ownerOf,
	podFor,
	type Rollout,
	rolledOut,
	SPEC_HASH,
	serviceFor,
} from "./workload.ts";

export const FINALIZER = "lisptc.io/cleanup";
const SOON_SECONDS = 2;

export interface Placement {
	prefix: string;
	release: string;
	pullSecret?: string;
	rollout?: Rollout;
}

export interface Deps {
	cluster: Cluster;
	servers: Servers;
	sink: StatusSink;
	placement: Placement;
	now: number;
}

export interface Outcome {
	requeueAt?: number;
}

const ROW_PHASE: Record<
	ServerPhase,
	"starting" | "ready" | "sleeping" | "failed"
> = {
	Starting: "starting",
	Ready: "ready",
	Sleeping: "sleeping",
	Failed: "failed",
};

function sameStatus(a: McpServerStatus, b: McpServerStatus): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function tail(logs: string): string {
	return logs.trim().split("\n").slice(-20).join("\n");
}

class Run {
	readonly namespace: string;
	readonly name: string;
	readonly before: McpServerStatus;

	constructor(
		readonly server: McpServer,
		readonly deps: Deps,
	) {
		this.namespace = namespaceFor(deps.placement.prefix, server.spec.workspace);
		this.name = server.metadata.name;
		this.before = server.status ?? {};
	}

	async settle(status: McpServerStatus, requeueAt?: number): Promise<Outcome> {
		const next = {
			...status,
			observedGeneration: this.server.metadata.generation,
		};
		if (
			next.phase &&
			(next.phase !== this.before.phase || next.reason !== this.before.reason)
		)
			await this.deps.sink.observeServer({
				...ownerOf(this.server),
				phase: ROW_PHASE[next.phase],
				...(next.reason ? { reason: next.reason } : {}),
			});
		if (!sameStatus(next, this.before))
			await this.deps.servers.writeStatus(this.server, next);
		return requeueAt === undefined ? {} : { requeueAt };
	}

	async finalize(): Promise<Outcome> {
		const { cluster, servers, sink } = this.deps;
		await cluster.remove(this.namespace, this.name);
		await servers.setFinalizers(
			this.server,
			(this.server.metadata.finalizers ?? []).filter((f) => f !== FINALIZER),
		);
		await sink.observeServer({
			...ownerOf(this.server),
			phase: "gone",
		});
		return {};
	}

	async prepareNamespace(): Promise<void> {
		const { cluster, placement } = this.deps;
		await cluster.ensureNamespace(
			namespaceManifest(this.namespace, this.server.spec.workspace),
		);
		await cluster.ensureNetworkPolicy(this.namespace, egressPolicy());
		await cluster.ensureNetworkPolicy(
			this.namespace,
			ingressPolicy(placement.release),
		);
		if (placement.pullSecret)
			await cluster.copySecret(
				placement.release,
				this.namespace,
				placement.pullSecret,
			);
		const { secret } = this.server.spec.mcp;
		if (secret)
			await cluster.copySecret(placement.release, this.namespace, secret);
	}

	async sleep(): Promise<Outcome> {
		await this.deps.cluster.remove(this.namespace, this.name);
		return await this.settle({ phase: "Sleeping" });
	}

	async ensureFinalizer(): Promise<void> {
		const finalizers = this.server.metadata.finalizers ?? [];
		if (finalizers.includes(FINALIZER)) return;
		await this.deps.servers.setFinalizers(this.server, [
			...finalizers,
			FINALIZER,
		]);
	}

	async currentPod(): Promise<V1Pod | undefined> {
		const { cluster, placement } = this.deps;
		const running = {
			...this.server,
			spec: rolledOut(this.server.spec, placement.rollout),
		};
		const pod = await cluster.pod(this.namespace, this.name);
		if (
			pod &&
			pod.metadata?.labels?.[SPEC_HASH] !== workloadHash(running.spec)
		) {
			await cluster.removePod(this.namespace, this.name);
			return undefined;
		}
		await cluster.ensureService(this.namespace, serviceFor(this.server));
		if (!pod)
			await cluster.createPod(
				this.namespace,
				podFor(running, {
					namespace: this.namespace,
					pullSecret: placement.pullSecret,
				}),
			);
		return pod;
	}

	async observe(pod: V1Pod): Promise<Outcome> {
		const { cluster, now } = this.deps;
		const { spec } = this.server;
		const wake = spec.lastUsed + spec.idleSeconds;
		const endpoints = endpointsFor(this.server, (port) =>
			cluster.origin(this.namespace, this.name, port),
		);
		const observed = stateOf(pod);
		const soon = now + SOON_SECONDS;
		if (observed.phase === "failed") {
			const logs = await cluster.logs(
				this.namespace,
				this.name,
				observed.container ?? "mcp",
			);
			return await this.settle(
				{
					phase: "Failed",
					reason: observed.reason,
					endpoints,
					...(logs.trim() ? { logTail: tail(logs) } : {}),
				},
				wake,
			);
		}
		if (observed.phase === "starting") {
			const reason =
				(observed.creating
					? await cluster.lastEvent(this.namespace, this.name)
					: undefined) ?? observed.reason;
			return await this.settle({ phase: "Starting", reason, endpoints }, soon);
		}
		if (!(await cluster.reachable(endpoints.mcp ?? "")))
			return await this.settle(
				{
					phase: "Starting",
					reason: `waiting for it to answer at ${endpoints.mcp}`,
					endpoints,
				},
				soon,
			);
		return await this.settle({ phase: "Ready", endpoints }, wake);
	}

	async run(): Promise<Outcome> {
		const { now } = this.deps;
		const { spec, metadata } = this.server;
		if (metadata.deletionTimestamp) return await this.finalize();
		await this.ensureFinalizer();
		if (now - spec.lastUsed >= spec.idleSeconds) return await this.sleep();
		await this.prepareNamespace();
		const pod = await this.currentPod();
		if (!pod)
			return await this.settle(
				{ phase: "Starting", reason: "creating its pod" },
				now + SOON_SECONDS,
			);
		return await this.observe(pod);
	}
}

export async function reconcile(
	server: McpServer,
	deps: Deps,
): Promise<Outcome> {
	return await new Run(server, deps).run();
}
