import { createServer, type Server } from "node:http";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { serve } from "../helpers.ts";

interface CapturedEvent {
	event: string;
	distinct_id: string;
	properties: Record<string, unknown>;
}

const PORT = 9932;
const events: CapturedEvent[] = [];
let server: Server;
let fetchApp: (request: Request) => Response | Promise<Response>;

beforeAll(async () => {
	server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => {
			const raw = Buffer.concat(chunks);
			const text =
				req.headers["content-encoding"] === "gzip"
					? gunzipSync(raw).toString()
					: raw.toString();
			try {
				events.push(
					...((JSON.parse(text) as { batch?: CapturedEvent[] }).batch ?? []),
				);
			} catch {}
			res.writeHead(200, { "content-type": "application/json" });
			res.end("{}");
		});
	});
	await new Promise<void>((resolve) => server.listen(PORT, resolve));

	process.env.POSTHOG_API_KEY = "phc_test";
	process.env.POSTHOG_HOST = `http://127.0.0.1:${PORT}`;
	process.env.POSTHOG_ENVIRONMENT = "test";

	const { edge } = await import("../../server/agent/edge.ts");

	fetchApp = serve({
		middleware: edge,
		handler: () => {
			throw new Error("the interpreter gave up");
		},
	});
});

afterAll(async () => {
	const { shutdownTelemetry } = await import("@repo/ai");
	await shutdownTelemetry();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function drain(): Promise<CapturedEvent[]> {
	const { shutdownTelemetry } = await import("@repo/ai");
	await shutdownTelemetry();
	await new Promise((resolve) => setTimeout(resolve, 100));
	return events;
}

describe("the telemetry middleware", () => {
	test("hands a failing request's identity and route to the exception", async () => {
		const response = await fetchApp(
			new Request("http://api.test/api/boom?q=1", {
				headers: {
					"x-distinct-id": "web-7",
					"x-posthog-session-id": "session-9",
					"user-agent": "a browser",
					"x-forwarded-for": "203.0.113.7, 10.0.0.1",
				},
			}),
		);
		expect(response.status).toBe(500);

		const exception = (await drain()).find((e) => e.event === "$exception");

		expect(exception?.distinct_id).toBe("web-7");
		expect(exception?.properties).toMatchObject({
			environment: "test",
			$session_id: "session-9",
			$request_method: "GET",
			$request_path: "/api/boom",
			$current_url: "http://api.test/api/boom?q=1",
			$user_agent: "a browser",
			$ip: "203.0.113.7",
			$response_status_code: 500,
		});
		expect(
			(exception?.properties.$exception_list as { value: string }[])[0].value,
		).toBe("the interpreter gave up");
	});
});
