import { describe, expect, it } from "vitest";
import { posthogTracer } from "@/lib/posthog-tracer.ts";

interface Captured {
	event: string;
	properties: Record<string, unknown>;
}

function recorder() {
	const captured: Captured[] = [];
	const exceptions: { error: unknown; properties: Record<string, unknown> }[] =
		[];
	const tracer = posthogTracer({
		capture: (event, properties) => captured.push({ event, properties }),
		captureException: (error, properties) =>
			exceptions.push({ error, properties }),
	});
	return { tracer, captured, exceptions };
}

const trace = {
	threadId: "run-1",
	turnId: "run-1/run",
	provider: "openrouter",
	model: "kimi-k2",
};

describe("the posthog tracer in the trace viewer", () => {
	it("sends a turn as the $ai_trace that roots its run", () => {
		const { tracer, captured } = recorder();
		tracer.turn({
			trace,
			name: "eval a",
			latencyMs: 1200,
			failed: true,
			attributes: { eval_grade: "fail" },
			content: { prompt: "ask", answer: "done" },
		});
		expect(captured).toEqual([
			{
				event: "$ai_trace",
				properties: {
					$ai_trace_id: "run-1",
					$ai_span_id: "run-1/run",
					$ai_provider: "openrouter",
					$ai_model: "kimi-k2",
					$ai_span_name: "eval a",
					$ai_latency: 1.2,
					$ai_is_error: true,
					eval_grade: "fail",
					$ai_input_state: "ask",
					$ai_output_state: "done",
				},
			},
		]);
	});

	it("sends generations and spans under the turn, each with its own span id", () => {
		const { tracer, captured } = recorder();
		tracer.generation({
			trace,
			name: "step 1",
			latencyMs: 0,
			failed: false,
			usage: { input: 10, output: 4 },
			content: { input: [{ role: "user", content: "ask" }], output: "(x)" },
		});
		tracer.span({
			trace,
			name: "repl eval 1",
			latencyMs: 0,
			failed: false,
			content: { input: "(x)", output: "1" },
		});
		const [generation, span] = captured;
		expect(generation.event).toBe("$ai_generation");
		expect(generation.properties).toMatchObject({
			$ai_trace_id: "run-1",
			$ai_parent_id: "run-1/run",
			$ai_input_tokens: 10,
			$ai_output_tokens: 4,
			$ai_input: [{ role: "user", content: "ask" }],
			$ai_output_choices: [{ role: "assistant", content: "(x)" }],
		});
		expect(span.event).toBe("$ai_span");
		expect(span.properties).toMatchObject({
			$ai_parent_id: "run-1/run",
			$ai_input_state: "(x)",
			$ai_output_state: "1",
		});
		expect(generation.properties.$ai_span_id).not.toBe(
			span.properties.$ai_span_id,
		);
	});

	it("sends no content a record does not carry", () => {
		const { tracer, captured } = recorder();
		tracer.span({ trace, name: "repl eval 1", latencyMs: 0, failed: false });
		expect(captured[0].properties).not.toHaveProperty("$ai_input_state");
		expect(captured[0].properties).not.toHaveProperty("$ai_output_state");
	});

	it("sends an exception joined to its trace", () => {
		const { tracer, exceptions } = recorder();
		const error = new Error("boom");
		tracer.exception({ error, trace, properties: { source: "eval" } });
		expect(exceptions).toEqual([
			{
				error,
				properties: {
					$ai_trace_id: "run-1",
					$ai_span_id: "run-1/run",
					source: "eval",
				},
			},
		]);
	});
});
