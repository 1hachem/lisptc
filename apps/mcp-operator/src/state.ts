import type { V1ContainerStatus, V1Pod } from "@kubernetes/client-node";

const FATAL_WAITING = new Set([
	"ErrImagePull",
	"ImagePullBackOff",
	"InvalidImageName",
	"CreateContainerConfigError",
	"CreateContainerError",
	"CrashLoopBackOff",
]);

const CREATING = new Set(["ContainerCreating", "PodInitializing"]);

export type PodState =
	| { phase: "starting"; reason: string; creating: boolean }
	| { phase: "ready" }
	| { phase: "failed"; reason: string; container?: string };

function exited(status: V1ContainerStatus): string | undefined {
	const exit = status.state?.terminated;
	if (!exit) return undefined;
	return `${status.name} exited with code ${exit.exitCode}${exit.reason ? ` (${exit.reason})` : ""}`;
}

function stuck(status: V1ContainerStatus): string | undefined {
	const waiting = status.state?.waiting;
	if (!waiting?.reason || !FATAL_WAITING.has(waiting.reason)) return undefined;
	return `${status.name}: ${waiting.reason}${waiting.message ? `: ${waiting.message}` : ""}`;
}

function unscheduled(pod: V1Pod): string | undefined {
	const scheduled = pod.status?.conditions?.find(
		(condition) => condition.type === "PodScheduled",
	);
	if (scheduled?.status !== "False") return undefined;
	return `waiting for a node: ${scheduled.message ?? scheduled.reason ?? "none fits"}`;
}

function starting(pod: V1Pod, containers: V1ContainerStatus[]): PodState {
	const waitingFor = unscheduled(pod);
	if (waitingFor)
		return { phase: "starting", reason: waitingFor, creating: false };
	const created = new Set(containers.map((status) => status.name));
	const creating =
		containers.find((status) =>
			CREATING.has(status.state?.waiting?.reason ?? ""),
		)?.name ??
		pod.spec?.containers.find((container) => !created.has(container.name))
			?.name;
	if (creating)
		return {
			phase: "starting",
			reason: `creating ${creating}`,
			creating: true,
		};
	const unready = containers.find((status) => !status.ready)?.name;
	return {
		phase: "starting",
		reason: unready
			? `waiting for ${unready} to accept connections`
			: "waiting for its containers",
		creating: false,
	};
}

export function stateOf(pod: V1Pod): PodState {
	const phase = pod.status?.phase;
	const containers = pod.status?.containerStatuses ?? [];
	for (const status of containers) {
		const reason = stuck(status) ?? exited(status);
		if (reason) return { phase: "failed", reason, container: status.name };
	}
	if (phase === "Failed" || phase === "Succeeded")
		return { phase: "failed", reason: `ended in phase ${phase}` };
	const expected = pod.spec?.containers.length ?? 1;
	const ready =
		phase === "Running" &&
		containers.length === expected &&
		containers.every((status) => status.ready);
	return ready ? { phase: "ready" } : starting(pod, containers);
}
