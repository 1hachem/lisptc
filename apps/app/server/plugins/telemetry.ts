import { shutdownTelemetry } from "@repo/ai";
import { definePlugin } from "nitro";

const DRAIN_MS = 5_000;

let stopping = false;

async function stop(signal: NodeJS.Signals): Promise<void> {
	if (stopping) return;
	stopping = true;
	console.log(`app shutting down (${signal})`);
	await new Promise((resolve) => setTimeout(resolve, DRAIN_MS));
	await shutdownTelemetry();
	process.exit(0);
}

export default definePlugin((nitroApp) => {
	nitroApp.hooks.hook("close", () => shutdownTelemetry());
	if (import.meta.dev) return;
	for (const signal of ["SIGTERM", "SIGINT"] as const)
		process.once(signal, () => void stop(signal));
});
