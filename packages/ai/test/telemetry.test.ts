import { createServer, type Server } from "node:http";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

interface CapturedEvent {
	event: string;
	distinct_id: string;
	properties: Record<string, unknown>;
}

const PORT = 9931;
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
	sessionId: "session-xyz",
	provider: "digitalocean",
	model: "gemma-4-31B-it",
};

async function drain(): Promise<CapturedEvent[]> {
	const { shutdownTelemetry } = await import("../src/telemetry.ts");
	await shutdownTelemetry();
	await new Promise((resolve) => setTimeout(resolve, 100));
	return events;
}

describe("telemetry", () => {
	test("a turn and its REPL evals share one trace id", async () => {
		const { captureReplEval, captureTurn } = await import(
			"../src/telemetry.ts"
		);

		captureReplEval(CTX, {
			step: 1,
			source: '(search-mcps "browser")',
			output: "playwright — Drive a real browser",
			error: false,
			latencyMs: 12,
		});
		captureTurn(CTX, {
			prompt: "Open hyko.ai",
			answer: "Opened it.",
			steps: 4,
			halted: true,
			latencyMs: 8200,
		});
		const captured = await drain();
		const by = (name: string) => captured.find((e) => e.event === name);

		expect(captured.map((e) => e.properties.$ai_trace_id)).toEqual([
			"thread-abc",
			"thread-abc",
		]);

		expect(captured.map((e) => e.properties.$session_id)).toEqual([
			"session-xyz",
			"session-xyz",
		]);

		const span = by("$ai_span");
		expect(span?.properties).toMatchObject({
			$ai_parent_id: "turn-1",
			$ai_span_name: "repl eval 1",
			$ai_latency: 0.012,
			$ai_is_error: false,
			$ai_input_state: '(search-mcps "browser")',
			$ai_output_state: "playwright — Drive a real browser",
		});

		const trace = by("$ai_trace");
		expect(trace?.properties).toMatchObject({
			$ai_span_id: "turn-1",
			$ai_latency: 8.2,
			steps: 4,
			halted: true,
		});

		expect(trace?.properties).toMatchObject({ environment: "test" });
		expect(trace?.distinct_id).toBe("dev-1");
	});
});
