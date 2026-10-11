import type { V1ContainerStatus, V1Pod } from "@kubernetes/client-node";

const FATAL_WAITING = new Set([
	"ErrImagePull",
	"ImagePullBackOff",
	"InvalidImageName",
	"CreateContainerConfigError",
	"CreateContainerError",
	"CrashLoopBackOff",
]);

export type PodState =
	| { phase: "starting" }
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
	return ready ? { phase: "ready" } : { phase: "starting" };
}
