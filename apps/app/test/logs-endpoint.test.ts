import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";

const paths: string[] = [];

const server = createServer((req, res) => {
	req.resume();
	req.on("end", () => {
		paths.push(req.url ?? "");
		res.writeHead(200, { "content-type": "application/json" }).end("{}");
	});
});

let logs: typeof import("../server/logs.ts");

beforeAll(async () => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	process.env.POSTHOG_API_KEY = "phc_test";
	process.env.POSTHOG_HOST = "http://127.0.0.1:1";
	process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = `http://127.0.0.1:${port}/collector/v1/logs`;
	logs = await import("../server/logs.ts");
});

afterAll(() => {
	server.close();
});

test("console output reaches the configured otlp endpoint", async () => {
	logs.startLogs();
	console.info("routed elsewhere");
	await logs.shutdownLogs();

	expect(paths).toEqual(["/collector/v1/logs"]);
});
