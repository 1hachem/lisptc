import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import type { TraceContext, Tracer } from "@repo/ai";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

interface CapturedEvent {
	event: string;
	distinct_id: string;
	properties: Record<string, unknown>;
}

const events: CapturedEvent[] = [];
let server: Server;
let tracer: Tracer;

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
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const { port } = server.address() as AddressInfo;

	process.env.POSTHOG_API_KEY = "phc_test";
	process.env.POSTHOG_HOST = `http://127.0.0.1:${port}`;
	process.env.POSTHOG_ENVIRONMENT = "test";

	({ tracer } = await import("../../server/agent/tracer.ts"));
});

afterAll(async () => {
	await tracer.flush();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

const TRACE: TraceContext = {
	threadId: "thread-abc",
	turnId: "turn-1",
	distinctId: "dev-1",
	sessionId: "session-xyz",
	provider: "digitalocean",
	model: "gemma-4-31B-it",
};

async function drain(): Promise<CapturedEvent[]> {
	await tracer.flush();
	return events;
}

describe("the posthog tracer", () => {
	test("a turn and its REPL evals share one trace id", async () => {
		tracer.span({
			trace: TRACE,
			name: "repl eval 1",
			latencyMs: 12,
			failed: false,
			attributes: { step: 1 },
			content: {
				input: '(search-mcps "browser")',
				output: "playwright — Drive a real browser",
			},
		});
		tracer.turn({
			trace: TRACE,
			name: "chat turn",
			latencyMs: 8200,
			failed: false,
			attributes: { steps: 4, halted: true },
			content: { prompt: "Open hyko.ai", answer: "Opened it." },
		});
		const captured = (await drain()).filter(
			(e) => e.event === "$ai_span" || e.event === "$ai_trace",
		);
		const by = (name: string) => captured.find((e) => e.event === name);

		expect(captured.map((e) => e.properties.$ai_trace_id)).toEqual([
			"thread-abc",
			"thread-abc",
		]);
		expect(captured.map((e) => e.properties.$session_id)).toEqual([
			"session-xyz",
			"session-xyz",
		]);

		expect(by("$ai_span")?.properties).toMatchObject({
			$ai_parent_id: "turn-1",
			$ai_span_name: "repl eval 1",
			$ai_latency: 0.012,
			$ai_is_error: false,
			$ai_input_state: '(search-mcps "browser")',
			$ai_output_state: "playwright — Drive a real browser",
			step: 1,
		});

		const trace = by("$ai_trace");
		expect(trace?.properties).toMatchObject({
			$ai_span_id: "turn-1",
			$ai_latency: 8.2,
			steps: 4,
			halted: true,
			environment: "test",
		});
		expect(trace?.distinct_id).toBe("dev-1");
	});
});

describe("generations", () => {
	test("nest under the turn, with model, tokens and cost inputs", async () => {
		tracer.generation({
			trace: TRACE,
			name: "extract",
			provider: "digitalocean",
			model: "a-small-one",
			latencyMs: 640,
			failed: false,
			usage: { input: 11, output: 7, cachedInput: 4 },
			attributes: { structured: true },
			content: {
				input: [{ role: "user", content: "one and two" }],
				output: '{"words":["one","two"]}',
			},
		});
		const generation = (await drain()).find(
			(e) =>
				e.event === "$ai_generation" &&
				e.properties.$ai_span_name === "extract",
		);

		expect(generation?.properties).toMatchObject({
			$ai_trace_id: "thread-abc",
			$ai_parent_id: "turn-1",
			$ai_provider: "digitalocean",
			$ai_model: "a-small-one",
			$ai_input_tokens: 11,
			$ai_output_tokens: 7,
			$ai_cache_read_input_tokens: 4,
			$ai_latency: 0.64,
			$ai_is_error: false,
			structured: true,
			$ai_input: [{ role: "user", content: "one and two" }],
			$ai_output_choices: [
				{ role: "assistant", content: '{"words":["one","two"]}' },
			],
		});
	});

	test("a failed call is a generation marked as an error", async () => {
		tracer.generation({
			trace: TRACE,
			name: "write",
			latencyMs: 100,
			failed: true,
			error: "llm timed out",
		});
		const errored = (await drain()).filter(
			(e) =>
				e.event === "$ai_generation" && e.properties.$ai_span_name === "write",
		);

		expect(errored).toHaveLength(1);
		expect(errored[0].properties).toMatchObject({
			$ai_is_error: true,
			$ai_error: "llm timed out",
		});
		expect(errored[0].properties.$ai_provider).toBeUndefined();
	});
});

describe("exceptions", () => {
	test("hang off the turn they failed in", async () => {
		tracer.exception({
			error: new Error("the model refused to answer"),
			trace: TRACE,
			properties: { steps: 3 },
		});
		const exception = (await drain()).find(
			(e) =>
				e.event === "$exception" &&
				(e.properties.$exception_list as { value: string }[])[0].value ===
					"the model refused to answer",
		);

		expect(exception?.distinct_id).toBe("dev-1");
		expect(exception?.properties).toMatchObject({
			environment: "test",
			$session_id: "session-xyz",
			$ai_trace_id: "thread-abc",
			$ai_span_id: "turn-1",
			steps: 3,
		});
	});

	test("with no distinct id create no person", async () => {
		tracer.exception({
			error: new Error("nobody was logged in"),
			trace: {},
			properties: {},
		});
		const anonymous = (await drain()).find(
			(e) =>
				e.event === "$exception" &&
				(e.properties.$exception_list as { value: string }[])[0].value ===
					"nobody was logged in",
		);

		expect(anonymous?.properties.$process_person_profile).toBe(false);
		expect(anonymous?.properties.$ai_trace_id).toBeUndefined();
	});
});
