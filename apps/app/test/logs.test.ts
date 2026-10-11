import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";

interface Received {
	path: string;
	headers: IncomingHttpHeaders;
	body: OtlpLogs;
}

interface OtlpLogs {
	resourceLogs: {
		resource: { attributes: { key: string; value: { stringValue: string } }[] };
		scopeLogs: {
			logRecords: {
				severityNumber: number;
				severityText: string;
				body: { stringValue: string };
			}[];
		}[];
	}[];
}

const received: Received[] = [];

const server = createServer((req, res) => {
	let raw = "";
	req.on("data", (chunk) => {
		raw += chunk;
	});
	req.on("end", () => {
		received.push({
			path: req.url ?? "",
			headers: req.headers,
			body: JSON.parse(raw),
		});
		res.writeHead(200, { "content-type": "application/json" }).end("{}");
	});
});

let logs: typeof import("../server/logs.ts");

beforeAll(async () => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	process.env.POSTHOG_API_KEY = "phc_test";
	process.env.POSTHOG_HOST = `http://127.0.0.1:${port}`;
	process.env.VITE_CONVEX_URL = "http://127.0.0.1:3210";
	process.env.VITE_ENVIRONMENT = "prod";
	process.env.POSTHOG_ENVIRONMENT = "pr-42";
	process.env.VITE_POSTHOG_KEY = "test";
	process.env.VITE_POSTHOG_SURVEY_ID = "test";
	process.env.CONVEX_URL = "http://127.0.0.1:3210";
	process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
	logs = await import("../server/logs.ts");
});

afterAll(() => {
	server.close();
});

test("console output reaches posthog as the app service named for its environment", async () => {
	logs.startLogs();
	console.warn("slow turn %dms", 1200);
	await logs.shutdownLogs();

	expect(received).toHaveLength(1);
	const [request] = received;
	expect(request?.path).toBe("/i/v1/logs");
	expect(request?.headers.authorization).toBe("Bearer phc_test");

	const [resourceLogs] = request?.body.resourceLogs ?? [];
	const attributes = Object.fromEntries(
		(resourceLogs?.resource.attributes ?? []).map((a) => [
			a.key,
			a.value.stringValue,
		]),
	);
	expect(attributes["service.name"]).toBe("app-pr-42");
	expect(attributes).not.toHaveProperty("deployment.environment.name");

	const records = resourceLogs?.scopeLogs.flatMap((s) => s.logRecords) ?? [];
	expect(records).toContainEqual(
		expect.objectContaining({
			severityText: "WARN",
			body: { stringValue: "slow turn 1200ms" },
		}),
	);
});
