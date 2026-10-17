import { shutdownTelemetry } from "@repo/ai";
import { definePlugin } from "nitro";
import { repls } from "../agent/repls.ts";
import { shutdownLogs, startLogs } from "../logs.ts";

const DRAIN_MS = 5_000;

let stopping = false;

async function flush(): Promise<void> {
	await repls.close();
	await shutdownTelemetry();
	await shutdownLogs();
}

async function stop(signal: NodeJS.Signals): Promise<void> {
	if (stopping) return;
	stopping = true;
	console.log(`app shutting down (${signal})`);
	await new Promise((resolve) => setTimeout(resolve, DRAIN_MS));
	await flush();
	process.exit(0);
}

export default definePlugin((nitroApp) => {
	startLogs();
	nitroApp.hooks.hook("close", flush);
	if (import.meta.dev) return;
	for (const signal of ["SIGTERM", "SIGINT"] as const)
		process.once(signal, () => void stop(signal));
});
