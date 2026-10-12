import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";

interface Attribute {
	key: string;
	value: { stringValue: string };
}

interface OtlpLogs {
	resourceLogs: {
		resource: { attributes: Attribute[] };
		scopeLogs: {
			logRecords: {
				severityText: string;
				body: { stringValue: string };
				attributes?: Attribute[];
			}[];
		}[];
	}[];
}

interface Received {
	path: string;
	headers: IncomingHttpHeaders;
	body: OtlpLogs;
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

const flat = (attributes: Attribute[] = []) =>
	Object.fromEntries(attributes.map((a) => [a.key, a.value.stringValue]));

let logs: typeof import("../server/logs.ts");

beforeAll(async () => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	process.env.POSTHOG_API_KEY = "phc_test";
	process.env.POSTHOG_HOST = `http://127.0.0.1:${port}`;
	process.env.POSTHOG_ENVIRONMENT = "pr-42";
	logs = await import("../server/logs.ts");
});

afterAll(() => {
	server.close();
});

test("console output reaches posthog as the app service, tagged with the caller", async () => {
	logs.startLogs();
	logs.withLogContext({ distinctId: "user-7", sessionId: "session-9" }, () =>
		console.warn("slow turn %dms", 1200),
	);
	console.log("outside a request");
	await logs.shutdownLogs();

	expect(received).toHaveLength(1);
	const [request] = received;
	expect(request?.path).toBe("/i/v1/logs");
	expect(request?.headers.authorization).toBe("Bearer phc_test");

	const [resourceLogs] = request?.body.resourceLogs ?? [];
	expect(flat(resourceLogs?.resource.attributes)).toMatchObject({
		"service.name": "app",
		"deployment.environment.name": "pr-42",
	});

	const records = resourceLogs?.scopeLogs.flatMap((s) => s.logRecords) ?? [];
	const warn = records.find((r) => r.body.stringValue === "slow turn 1200ms");
	expect(warn?.severityText).toBe("WARN");
	expect(flat(warn?.attributes)).toEqual({
		posthogDistinctId: "user-7",
		sessionId: "session-9",
	});

	const outside = records.find(
		(r) => r.body.stringValue === "outside a request",
	);
	expect(outside?.severityText).toBe("INFO");
	expect(flat(outside?.attributes)).toEqual({});
});
