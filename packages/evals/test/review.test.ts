import type {
	GenerationRecord,
	SpanRecord,
	Tracer,
	TurnRecord,
} from "@repo/ai";
import { describe, expect, test } from "vitest";
import type { ReportRow, TranscriptLine } from "../src/report.ts";
import { fitTrace, reviewProperties, runId, traceRun } from "../src/review.ts";

const IDENTITY = {
	file: "2026-09-12T10-00-00.json",
	startedAt: "2026-09-12T10:00:00.000Z",
	sha: "deadbee",
};

interface Traced {
	turns: TurnRecord[];
	spans: SpanRecord[];
	generations: GenerationRecord[];
}

function traced(subject: ReportRow, budget?: number): Traced {
	const seen: Traced = { turns: [], spans: [], generations: [] };
	const tracer: Tracer = {
		turn: (record) => seen.turns.push(record),
		span: (record) => seen.spans.push(record),
		generation: (record) => seen.generations.push(record),
		exception: () => {},
		withRequest: (_context, run) => run(),
		flush: async () => {},
	};
	traceRun(tracer, IDENTITY, subject, budget);
	return seen;
}

function line(
	role: Exclude<TranscriptLine["role"], "entry">,
	content: string,
): TranscriptLine {
	return { role, content };
}

function row(transcript: TranscriptLine[]): ReportRow {
	return {
		case: "connect-and-query",
		sample: 1,
		provider: "openrouter",
		model: "kimi-k2",
		grade: "pass",
		steps: 3,
		min: 2,
		max: 8,
		halted: true,
		answer: "done",
		inputTokens: 10,
		outputTokens: 4,
		durationMs: 1200,
		errors: 0,
		skips: 0,
		checks: [
			{ name: "calls linear", verdict: "true" },
			{ name: "answers", verdict: "false" },
		],
		transcript,
	};
}

describe("fitting a trace into one event", () => {
	const long = Array.from({ length: 10 }, (_, i) =>
		line(i % 2 === 0 ? "assistant" : "tool", `turn ${i} ${"x".repeat(100)}`),
	);

	test("sends the whole trace when it fits", () => {
		const fitted = fitTrace(long, 0, 100_000);
		expect(fitted.lines).toHaveLength(10);
		expect(fitted.dropped).toBe(0);
		expect(fitted.from).toBe(0);
	});

	test("keeps the voted turn when the budget only covers part of it", () => {
		const fitted = fitTrace(long, 7, 400);
		expect(fitted.dropped).toBeGreaterThan(0);
		expect(fitted.lines).toContain(long[7]);
		expect(fitted.from + fitted.lines.length).toBeLessThanOrEqual(10);
	});

	test("truncates a single turn too big to send whole", () => {
		const huge = [line("assistant", "y".repeat(5000))];
		const fitted = fitTrace(huge, 0, 200);
		expect(fitted.lines[0].content.length).toBeLessThan(200);
		expect(fitted.lines[0].content.endsWith("…")).toBe(true);
	});

	test("an empty transcript fits trivially", () => {
		expect(fitTrace([], 0)).toEqual({ lines: [], from: 0, dropped: 0 });
	});
});

describe("the review payload", () => {
	const subject = row([
		line("user", "find the auth bug"),
		line("assistant", '(await (load-mcp "linear"))'),
	]);

	test("names the run so every vote on it joins", () => {
		expect(runId(IDENTITY, subject)).toBe(
			"2026-09-12T10-00-00.json#connect-and-query/openrouter/kimi-k2/1",
		);
	});

	test("carries the run, the checks and the voted turn", () => {
		const properties = reviewProperties(IDENTITY, subject, 1);
		expect(properties.eval_case).toBe("connect-and-query");
		expect(properties.eval_model).toBe("kimi-k2");
		expect(properties.eval_checks_passed).toBe(1);
		expect(properties.eval_checks_total).toBe(2);
		expect(properties.eval_checks_failed).toEqual(["answers"]);
		expect(properties.message_index).toBe(1);
		expect(properties.message_role).toBe("assistant");
		expect(properties.message).toBe('(await (load-mcp "linear"))');
		expect(properties.trace_turns).toBe(2);
	});

	test("joins the trace the vote is sent with", () => {
		const properties = reviewProperties(IDENTITY, subject, 1);
		const { turns, generations } = traced(subject);
		expect(properties.$ai_trace_id).toBe(runId(IDENTITY, subject));
		expect(turns[0].trace.threadId).toBe(properties.$ai_trace_id);
		expect(generations[0].attributes?.message_span_id).toBe(
			properties.message_span_id,
		);
	});
});

describe("the run as a trace", () => {
	const subject = row([
		line("user", "find the auth bug"),
		line("assistant", '(await (load-mcp "linear"))'),
		line("tool", '{"output":"loaded"}'),
		line("assistant", "found it, the token refresh races"),
	]);

	test("opens with one turn carrying the run's own numbers", () => {
		const { turns } = traced(subject);
		expect(turns).toHaveLength(1);
		const [root] = turns;
		expect(root.name).toBe("eval connect-and-query");
		expect(root.content).toEqual({
			prompt: "find the auth bug",
			answer: "done",
		});
		expect(root.latencyMs).toBe(1200);
		expect(root.failed).toBe(false);
		expect(root.trace.provider).toBe("openrouter");
		expect(root.trace.model).toBe("kimi-k2");
		expect(root.attributes?.eval_input_tokens).toBe(10);
		expect(root.attributes?.eval_checks_failed).toEqual(["answers"]);
	});

	test("a run that never halted is a failed turn", () => {
		const { turns } = traced({ ...subject, halted: false });
		expect(turns[0].failed).toBe(true);
	});

	test("makes a generation of every agent turn, under the run", () => {
		const { turns, generations, spans } = traced(subject);
		expect(generations).toHaveLength(2);
		expect(generations[0].name).toBe("step 1");
		expect(generations[0].model).toBe("kimi-k2");
		expect(generations[0].content).toEqual({
			input: [{ role: "user", content: "find the auth bug" }],
			output: '(await (load-mcp "linear"))',
		});
		expect(generations[1].content?.input).toEqual([
			{ role: "user", content: "find the auth bug" },
			{ role: "assistant", content: '(await (load-mcp "linear"))' },
			{ role: "user", content: '{"output":"loaded"}' },
		]);
		for (const record of [...generations, ...spans])
			expect(record.trace).toEqual(turns[0].trace);
	});

	test("makes a span of every repl result", () => {
		const { spans } = traced(subject);
		expect(spans).toHaveLength(1);
		expect(spans[0].name).toBe("repl eval 1");
		expect(spans[0].content).toEqual({
			input: '(await (load-mcp "linear"))',
			output: '{"output":"loaded"}',
		});
	});

	test("clamps a repl result to the budget", () => {
		const { spans } = traced(
			row([line("assistant", "(big)"), line("tool", "z".repeat(5000))]),
			200,
		);
		expect(spans[0].content?.output.length).toBeLessThan(200);
	});

	test("names every turn of one run under the same trace, each with its own message", () => {
		const { turns, generations, spans } = traced(subject);
		expect(turns[0].trace.threadId).toBe(runId(IDENTITY, subject));
		const messages = [...generations, ...spans].map(
			(record) => record.attributes?.message_span_id,
		);
		expect(new Set(messages).size).toBe(3);
	});
});
