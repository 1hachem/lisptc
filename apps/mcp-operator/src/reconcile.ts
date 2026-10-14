import type { V1PersistentVolumeClaim, V1Pod } from "@kubernetes/client-node";
import {
	type ClaimStatus,
	claimName,
	type McpServer,
	type McpServerStatus,
	type ServerPhase,
	type State,
	workloadHash,
} from "@repo/mcp-extension/kubernetes";
import type { Cluster, Servers } from "./cluster.ts";
import { stateOf } from "./state.ts";
import type { StateRowPhase, StatusSink } from "./status-sink.ts";
import {
	claimFor,
	claimTerms,
	egressPolicy,
	endpointsFor,
	ingressPolicy,
	namespaceFor,
	namespaceManifest,
	podFor,
	RECLAIM,
	RELEASED_AT,
	SPEC_HASH,
	STATE_LABEL,
	STATE_PATH,
	selectorFor,
	serviceFor,
	statesOf,
} from "./workload.ts";

export const FINALIZER = "lisptc.io/cleanup";
const SOON_SECONDS = 2;

export interface Placement {
	prefix: string;
	release: string;
	pullSecret?: string;
	storageClass?: string;
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

function requested(claim: V1PersistentVolumeClaim): string | undefined {
	return claim.spec?.resources?.requests?.storage;
}

function resizing(claim: V1PersistentVolumeClaim): boolean {
	const capacity = claim.status?.capacity?.storage;
	return (
		(claim.status?.conditions ?? []).some(
			(condition) =>
				condition.type === "Resizing" ||
				condition.type === "FileSystemResizePending",
		) ||
		(capacity !== undefined && capacity !== requested(claim))
	);
}

function claimPhase(claim: V1PersistentVolumeClaim): ClaimStatus["phase"] {
	if (claim.status?.phase !== "Bound") return "Pending";
	return resizing(claim) ? "Resizing" : "Bound";
}

function annotations(claim: V1PersistentVolumeClaim): Record<string, string> {
	return claim.metadata?.annotations ?? {};
}

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
				workspace: this.server.spec.workspace,
				server: this.server.spec.server,
				phase: ROW_PHASE[next.phase],
				...(next.reason ? { reason: next.reason } : {}),
			});
		await this.mirrorState(next.state ?? {});
		if (!sameStatus(next, this.before))
			await this.deps.servers.writeStatus(this.server, next);
		return requeueAt === undefined ? {} : { requeueAt };
	}

	async mirrorState(state: Record<string, ClaimStatus>): Promise<void> {
		for (const entry of statesOf(this.server)) {
			const now = state[entry.name];
			const was = this.before.state?.[entry.name];
			if (!now) continue;
			if (
				was &&
				was.phase === now.phase &&
				was.size === now.size &&
				was.lastAttached === now.lastAttached
			)
				continue;
			await this.deps.sink.observeState({
				workspace: this.server.spec.workspace,
				server: this.server.spec.server,
				name: entry.name,
				path: entry.path,
				size: now.size,
				phase: now.phase.toLowerCase() as StateRowPhase,
				...(now.lastAttached ? { lastAttached: now.lastAttached } : {}),
			});
		}
	}

	async release(claim: V1PersistentVolumeClaim): Promise<void> {
		const notes = annotations(claim);
		if (notes[RELEASED_AT]) return;
		const { cluster, now, sink } = this.deps;
		await cluster.annotateClaim(this.namespace, claim.metadata?.name ?? "", {
			[RELEASED_AT]: String(now),
		});
		await sink.observeState({
			workspace: this.server.spec.workspace,
			server: this.server.spec.server,
			name: claim.metadata?.labels?.[STATE_LABEL] ?? "",
			path: notes[STATE_PATH] ?? "",
			size: requested(claim) ?? "",
			phase: "released",
			releasedAt: now,
		});
	}

	async finalize(): Promise<Outcome> {
		const { cluster, servers, sink } = this.deps;
		await cluster.remove(this.namespace, this.name);
		for (const claim of await cluster.claims(
			this.namespace,
			selectorFor(this.name),
		)) {
			if (annotations(claim)[RECLAIM] === "Delete") {
				await cluster.deleteClaim(this.namespace, claim.metadata?.name ?? "");
				await sink.observeState({
					workspace: this.server.spec.workspace,
					server: this.server.spec.server,
					name: claim.metadata?.labels?.[STATE_LABEL] ?? "",
					path: annotations(claim)[STATE_PATH] ?? "",
					size: requested(claim) ?? "",
					phase: "gone",
				});
			} else await this.release(claim);
		}
		await servers.setFinalizers(
			this.server,
			(this.server.metadata.finalizers ?? []).filter((f) => f !== FINALIZER),
		);
		await sink.observeServer({
			workspace: this.server.spec.workspace,
			server: this.server.spec.server,
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

	async claimsByState(): Promise<Map<string, V1PersistentVolumeClaim>> {
		const claims = await this.deps.cluster.claims(
			this.namespace,
			selectorFor(this.name),
		);
		const wanted = new Set(statesOf(this.server).map((state) => state.name));
		const byState = new Map<string, V1PersistentVolumeClaim>();
		for (const claim of claims) {
			const state = claim.metadata?.labels?.[STATE_LABEL] ?? "";
			if (wanted.has(state)) byState.set(state, claim);
			else await this.release(claim);
		}
		return byState;
	}

	async settleClaim(
		state: State,
		claim: V1PersistentVolumeClaim | undefined,
	): Promise<{ status: ClaimStatus; ready: boolean }> {
		const { cluster, placement } = this.deps;
		const name = claimName(this.name, state.name);
		const observedReset =
			this.before.state?.[state.name]?.observedReset ?? state.reset;
		const pending = (reset: number): ClaimStatus => ({
			claim: name,
			phase: "Pending",
			size: state.size,
			observedReset: reset,
		});
		if (claim?.metadata?.deletionTimestamp)
			return { status: pending(observedReset), ready: false };
		if (claim && state.reset > observedReset) {
			await cluster.removePod(this.namespace, this.name);
			await cluster.deleteClaim(this.namespace, name);
			return { status: pending(observedReset), ready: false };
		}
		if (!claim) {
			await cluster.createClaim(
				this.namespace,
				claimFor(this.server, state, {
					namespace: this.namespace,
					storageClass: placement.storageClass,
				}),
			);
			return { status: pending(state.reset), ready: true };
		}
		const notes = annotations(claim);
		const terms = claimTerms(state);
		const drift = Object.entries(terms).some(
			([key, value]) => notes[key] !== value,
		);
		if (drift || notes[RELEASED_AT])
			await cluster.annotateClaim(this.namespace, name, {
				...terms,
				[RELEASED_AT]: null,
			});
		const status: ClaimStatus = {
			claim: name,
			phase: claimPhase(claim),
			size: requested(claim) ?? state.size,
			observedReset,
			...(this.before.state?.[state.name]?.lastAttached
				? { lastAttached: this.before.state[state.name]?.lastAttached }
				: {}),
		};
		if (requested(claim) !== state.size) {
			try {
				await cluster.resizeClaim(this.namespace, name, state.size);
				status.phase = "Resizing";
				status.size = state.size;
			} catch (ex) {
				status.reason = `cannot resize to ${state.size}: ${ex instanceof Error ? ex.message : String(ex)}`;
			}
		}
		return { status, ready: true };
	}

	async sleep(): Promise<Outcome> {
		const { cluster, now } = this.deps;
		const state: Record<string, ClaimStatus> = {};
		for (const [name, entry] of Object.entries(this.before.state ?? {}))
			state[name] =
				this.before.phase === "Sleeping"
					? entry
					: { ...entry, lastAttached: now };
		await cluster.remove(this.namespace, this.name);
		return await this.settle({ phase: "Sleeping", state });
	}

	async ensureFinalizer(): Promise<void> {
		const finalizers = this.server.metadata.finalizers ?? [];
		if (finalizers.includes(FINALIZER)) return;
		await this.deps.servers.setFinalizers(this.server, [
			...finalizers,
			FINALIZER,
		]);
	}

	async settleClaims(): Promise<{
		state: Record<string, ClaimStatus>;
		ready: boolean;
	}> {
		const byState = await this.claimsByState();
		const state: Record<string, ClaimStatus> = {};
		let ready = true;
		for (const entry of statesOf(this.server)) {
			const settled = await this.settleClaim(entry, byState.get(entry.name));
			state[entry.name] = settled.status;
			ready &&= settled.ready;
		}
		return { state, ready };
	}

	async currentPod(): Promise<V1Pod | undefined> {
		const { cluster, placement } = this.deps;
		const pod = await cluster.pod(this.namespace, this.name);
		if (
			pod &&
			pod.metadata?.labels?.[SPEC_HASH] !== workloadHash(this.server.spec)
		) {
			await cluster.removePod(this.namespace, this.name);
			return undefined;
		}
		await cluster.ensureService(this.namespace, serviceFor(this.server));
		if (!pod)
			await cluster.createPod(
				this.namespace,
				podFor(this.server, {
					namespace: this.namespace,
					pullSecret: placement.pullSecret,
				}),
			);
		return pod;
	}

	async observe(
		pod: V1Pod,
		state: Record<string, ClaimStatus>,
	): Promise<Outcome> {
		const { cluster, now } = this.deps;
		const { spec } = this.server;
		const wake = spec.lastUsed + spec.idleSeconds;
		const endpoints = endpointsFor(this.server, (port) =>
			cluster.origin(this.namespace, this.name, port),
		);
		const observed = stateOf(pod);
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
					state,
					...(logs.trim() ? { logTail: tail(logs) } : {}),
				},
				wake,
			);
		}
		const answering =
			observed.phase === "ready" &&
			(await cluster.reachable(endpoints.mcp ?? ""));
		if (!answering)
			return await this.settle(
				{ phase: "Starting", endpoints, state },
				now + SOON_SECONDS,
			);
		if (this.before.phase !== "Ready")
			for (const entry of Object.values(state)) entry.lastAttached = now;
		return await this.settle({ phase: "Ready", endpoints, state }, wake);
	}

	async run(): Promise<Outcome> {
		const { now } = this.deps;
		const { spec, metadata } = this.server;
		if (metadata.deletionTimestamp) return await this.finalize();
		await this.ensureFinalizer();
		if (now - spec.lastUsed >= spec.idleSeconds) {
			await this.claimsByState();
			return await this.sleep();
		}
		const soon = now + SOON_SECONDS;
		await this.prepareNamespace();
		const { state, ready } = await this.settleClaims();
		if (!ready) return await this.settle({ phase: "Starting", state }, soon);
		const pod = await this.currentPod();
		if (!pod) return await this.settle({ phase: "Starting", state }, soon);
		return await this.observe(pod, state);
	}
}

export async function reconcile(
	server: McpServer,
	deps: Deps,
): Promise<Outcome> {
	return await new Run(server, deps).run();
}
