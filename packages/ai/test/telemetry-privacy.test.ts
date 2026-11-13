import { createServer, type Server } from "node:http";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

interface CapturedEvent {
	event: string;
	properties: Record<string, unknown>;
}

const PRIVATE_MESSAGE = "cannot read the user's tax return";
const PRIVATE_CAUSE = "the user's password is hunter2";

const PORT = 9932;
const events: CapturedEvent[] = [];
let server: Server;

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
	process.env.POSTHOG_PRIVACY_MODE = "true";
});

afterAll(async () => {
	const { shutdownTelemetry } = await import("../src/telemetry.ts");
	await shutdownTelemetry();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

const CTX = {
	threadId: "thread-abc",
	turnId: "turn-1",
	distinctId: "dev-1",
};

async function drain(): Promise<CapturedEvent[]> {
	const { shutdownTelemetry } = await import("../src/telemetry.ts");
	await shutdownTelemetry();
	await new Promise((resolve) => setTimeout(resolve, 100));
	return events;
}

describe("error tracking in privacy mode", () => {
	test("an exception reaches posthog without its message", async () => {
		const { captureException } = await import("../src/telemetry.ts");

		captureException(
			new TypeError(PRIVATE_MESSAGE, { cause: new Error(PRIVATE_CAUSE) }),
			CTX,
			{ steps: 3 },
		);
		const exception = (await drain()).find((e) => e.event === "$exception");

		expect(exception?.properties).toMatchObject({
			$ai_trace_id: "thread-abc",
			$ai_span_id: "turn-1",
			steps: 3,
		});
		const list = exception?.properties.$exception_list as {
			type: string;
		}[];
		expect(list[0].type).toBe("TypeError");
		const sent = JSON.stringify(exception);
		expect(sent).not.toContain(PRIVATE_MESSAGE);
		expect(sent).not.toContain(PRIVATE_CAUSE);
	});
});
