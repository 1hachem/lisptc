import { serve } from "@hono/node-server";
import { shutdownTelemetry } from "@repo/ai";
import { serverEnv } from "@repo/env/server";
import app from "./app.ts";

const DRAIN_MS = 5_000;

const server = serve({ fetch: app.fetch, port: serverEnv.PORT }, (info) =>
	console.log(`@lisptc/api listening on http://localhost:${info.port}`),
);

let stopping = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
	if (stopping) return;
	stopping = true;
	console.log(`@lisptc/api shutting down (${signal})`);
	const closed = new Promise<void>((resolve) => server.close(() => resolve()));
	const drained = new Promise<void>((resolve) =>
		setTimeout(resolve, DRAIN_MS).unref(),
	);
	await Promise.race([closed, drained]);
	await shutdownTelemetry();
	process.exit(0);
}

for (const signal of ["SIGTERM", "SIGINT"] as const)
	process.on(signal, () => void shutdown(signal));
