import { createServer, type Server } from "node:http";
import { gunzipSync } from "node:zlib";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import {
	type LlmCall,
	llmSlot,
	type Observed,
} from "@repo/interpreter/observe";
import type {
	InterpExtension,
	ModelDelta,
	SessionHooks,
} from "@repo/interpreter/session";
import { recognizedKind } from "@repo/journal-catalog/memory";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";
import type { Line } from "../src/line.ts";
import { runAgentTurn, type TurnEvent, type TurnOptions } from "../src/turn.ts";
import { extension, recording, testRepl } from "./helpers.ts";

const PORT = 9931;

vi.setConfig({ testTimeout: 20_000 });

vi.hoisted(() => {
	process.env.POSTHOG_API_KEY = "phc_test";
	process.env.POSTHOG_HOST = "http://127.0.0.1:9931";
	process.env.POSTHOG_ENVIRONMENT = "test";
});

let script: ModelDelta[][] = [];
let throws: string | undefined;
let calls = 0;
let onCall: (() => void) | undefined;

vi.mock("../src/agent.ts", () => ({
	streamAgent: async function* () {
		onCall?.();
		if (throws) throw new Error(throws);
		for (const delta of script[Math.min(calls++, script.length - 1)])
			yield delta;
	},
}));

interface CapturedEvent {
	event: string;
	distinct_id: string;
	properties: Record<string, unknown>;
}

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
});

afterAll(async () => {
	const { shutdownTelemetry } = await import("../src/telemetry.ts");
	await shutdownTelemetry();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
	script = [];
	throws = undefined;
	calls = 0;
	onCall = undefined;
});

const ask: Line[] = [{ kind: "user", text: "what is 1 + 2?" }];

async function run(
	options: Partial<TurnOptions> = {},
): Promise<{ threadId: string; events: TurnEvent[] }> {
	const threadId = crypto.randomUUID();
	const seen: TurnEvent[] = [];
	for await (const event of runAgentTurn(ask, {
		repl: testRepl(),
		threadId,
		...options,
	}))
		seen.push(event);
	return { threadId, events: seen };
}

async function captured(threadId: string): Promise<CapturedEvent[]> {
	const { shutdownTelemetry } = await import("../src/telemetry.ts");
	await shutdownTelemetry();
	await new Promise((resolve) => setTimeout(resolve, 100));
	return events.filter((e) => e.properties.$ai_trace_id === threadId);
}

function named(list: CapturedEvent[], event: string): CapturedEvent[] {
	return list.filter((e) => e.event === event);
}

function failure(event: CapturedEvent | undefined): string | undefined {
	return (
		event?.properties.$exception_list as { value: string }[] | undefined
	)?.[0]?.value;
}

function callingLlm(made: LlmCall[]): InterpExtension {
	const observed: Observed = {};
	return Object.assign(
		(interp: Interp): void => {
			made.forEach((call, at) => {
				interp.defineGlobal(
					newSym(`llm-${at}`),
					interp.makeBuiltIn(`llm-${at}`, 0, () => {
						observed.observe?.(call);
						return null;
					}),
				);
			});
		},
		{ session: (hooks: SessionHooks) => hooks.fill(llmSlot, observed) },
	);
}

describe("a traced turn", () => {
	test("traces a turn once, with each step a span under it and the one that threw an error", async () => {
		script = [
			[{ text: "(car 5)" }],
			[{ text: "(+ 1 2)" }],
			[{ text: '"done"' }],
		];

		const { threadId } = await run({
			identity: { distinctId: "dev-1", sessionId: "session-xyz" },
		});
		const sent = await captured(threadId);

		const traces = named(sent, "$ai_trace");
		expect(traces).toHaveLength(1);
		expect(traces[0]).toMatchObject({
			distinct_id: "dev-1",
			properties: {
				$session_id: "session-xyz",
				$ai_input_state: "what is 1 + 2?",
				$ai_output_state: '"done"',
			},
		});
		expect(
			named(sent, "$ai_span").map((s) => ({
				step: s.properties.$ai_input_state,
				error: s.properties.$ai_is_error,
				under: s.properties.$ai_parent_id === traces[0].properties.$ai_span_id,
			})),
		).toEqual([
			{ step: "(car 5)", error: true, under: true },
			{ step: "(+ 1 2)", error: false, under: true },
			{ step: '"done"', error: false, under: true },
		]);
	});

	test("nests an llm call a step makes under the turn as a generation, a failed one marked an error", async () => {
		script = [[{ text: "(llm-0) (llm-1)" }], [{ text: "done." }]];
		const repl = testRepl([
			callingLlm([
				{
					builtin: "extract",
					provider: "digitalocean",
					model: "a-small-one",
					messages: [{ role: "user", content: "one and two" }],
					structured: true,
					latencyMs: 640,
					output: '{"words":["one","two"]}',
					inputTokens: 11,
					outputTokens: 7,
				},
				{
					builtin: "write",
					messages: [{ role: "user", content: "hi" }],
					structured: false,
					latencyMs: 100,
					error: "llm timed out",
				},
			]),
		]);

		const { threadId } = await run({ repl });
		const sent = await captured(threadId);

		const [trace] = named(sent, "$ai_trace");
		const [made, failed] = named(sent, "$ai_generation");
		expect(made.properties).toMatchObject({
			$ai_parent_id: trace.properties.$ai_span_id,
			$ai_span_name: "extract",
			$ai_provider: "digitalocean",
			$ai_model: "a-small-one",
			$ai_input_tokens: 11,
			$ai_output_tokens: 7,
			$ai_latency: 0.64,
			$ai_is_error: false,
			$ai_input: [{ role: "user", content: "one and two" }],
			$ai_output_choices: [
				{ role: "assistant", content: '{"words":["one","two"]}' },
			],
		});
		expect(failed.properties).toMatchObject({
			$ai_parent_id: trace.properties.$ai_span_id,
			$ai_span_name: "write",
			$ai_is_error: true,
			$ai_error: "llm timed out",
		});
		expect(failed.properties.$ai_provider).toBeUndefined();
	});
});

describe("a traced failure", () => {
	test("hangs a failed turn's exception off that turn, and traces none for an aborted one", async () => {
		throws = "upstream exploded";
		const failedTurn = await run({ identity: { distinctId: "dev-1" } });
		const sent = await captured(failedTurn.threadId);

		const [exception] = named(sent, "$exception");
		expect(failure(exception)).toBe("upstream exploded");
		expect(exception.distinct_id).toBe("dev-1");
		expect(exception.properties.$ai_span_id).toBe(
			named(sent, "$ai_trace")[0].properties.$ai_span_id,
		);

		const abort = new AbortController();
		onCall = () => abort.abort();
		throws = "aborted";
		const aborted = await run({ signal: abort.signal });
		expect(named(await captured(aborted.threadId), "$exception")).toEqual([]);
	});

	test("keeps the trace and the turn when a hook throws as the turn settles", async () => {
		script = [[{ text: "three." }]];
		const repl = testRepl([
			extension((hooks) =>
				hooks.settled.use(() => {
					throw new Error("observer broke");
				}),
			),
		]);

		const { threadId, events: ran } = await run({ repl });
		const sent = await captured(threadId);

		expect(ran.at(-1)).toMatchObject({ type: "halt", answer: "three." });
		expect(named(sent, "$ai_trace")).toHaveLength(1);
		expect(named(sent, "$exception").map(failure)).toEqual(["observer broke"]);
	});

	test("traces a hook that throws on what a message carried without the values it carried", async () => {
		script = [[{ text: "three." }]];
		const repl = testRepl([
			extension((hooks) =>
				hooks.received.use(() => {
					throw new Error("reader broke");
				}),
			),
		]);

		const { threadId } = await run({ repl, received: { said: "a secret" } });
		const [exception] = named(await captured(threadId), "$exception");

		expect(failure(exception)).toBe("reader broke");
		const { $exception_list: _trace, ...traced } = exception.properties;
		expect(JSON.stringify(traced)).not.toContain("a secret");
	});
});

describe("memory recognition", () => {
	test("is traced under the turn as a failed span carrying its error", async () => {
		script = [[{ text: "three." }]];
		let recorded = false;
		const repl = testRepl([
			extension((hooks) =>
				hooks.beginStep.use(function* (ctx, next) {
					if (!recorded)
						recording(ctx.interp.journal, recognizedKind.name, {
							message: "open the page",
							scores: { "internal/browser/local": 0.9 },
							fired: [{ key: "internal/browser/local", body: "load it" }],
							error: "recognition failed for deploy: timed out",
							failedAreas: ["deploy"],
							latencyMs: 2000,
						});
					recorded = true;
					yield* next(ctx);
				}),
			),
		]);

		const { threadId } = await run({ repl });
		const sent = await captured(threadId);

		const [trace] = named(sent, "$ai_trace");
		const span = named(sent, "$ai_span").find(
			(e) => e.properties.$ai_span_name === "memory recognition",
		);
		expect(span?.properties).toMatchObject({
			$ai_parent_id: trace.properties.$ai_span_id,
			$ai_is_error: true,
			$ai_error: "recognition failed for deploy: timed out",
		});
	});
});
