import { describe, expect, test } from "vitest";
import type { ReportRow, TranscriptLine } from "../src/report.ts";
import { fitTrace, reviewProperties, runId } from "../src/review.ts";

const IDENTITY = {
	file: "2026-09-12T10-00-00.json",
	startedAt: "2026-09-12T10:00:00.000Z",
	sha: "deadbee",
};

function line(role: TranscriptLine["role"], content: string): TranscriptLine {
	return { role, content };
}

function row(transcript: TranscriptLine[]): ReportRow {
	return {
		case: "connect-and-query",
		sample: 1,
		provider: "fireworks",
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
			"2026-09-12T10-00-00.json#connect-and-query/fireworks/kimi-k2/1",
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
		expect(properties.trace).toHaveLength(2);
		expect(properties.trace_dropped).toBe(0);
		expect(properties.trace_turns).toBe(2);
	});
});
