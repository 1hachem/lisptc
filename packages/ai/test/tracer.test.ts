import { describe, expect, test } from "vitest";
import { type TraceContext, tracing } from "../src/tracer.ts";
import { FakeTracer } from "./helpers.ts";

const trace: TraceContext = { threadId: "thread-1", turnId: "turn-1" };

function failing(): Error {
	return new Error("could not read the user's note: buy milk");
}

describe("tracing", () => {
	test("every tracer it is handed sees every record", async () => {
		const first = new FakeTracer();
		const second = new FakeTracer();
		const tracer = tracing([first, second], { privacy: false });

		tracer.span({
			trace,
			name: "repl eval 1",
			latencyMs: 4,
			failed: false,
			content: { input: "(+ 1 2)", output: "3" },
		});
		tracer.exception({ error: failing(), trace, properties: {} });
		await tracer.flush();

		for (const seen of [first, second]) {
			expect(seen.spans.map((s) => s.content)).toEqual([
				{ input: "(+ 1 2)", output: "3" },
			]);
			expect(seen.exceptions).toHaveLength(1);
			expect(seen.flushes).toBe(1);
		}
	});

	test("a request context reaches every tracer around the same run", () => {
		const first = new FakeTracer();
		const second = new FakeTracer();
		const tracer = tracing([first, second], { privacy: false });

		const answer = tracer.withRequest({ distinctId: "user-1" }, () => 42);

		expect(answer).toBe(42);
		expect(first.requests).toEqual([{ distinctId: "user-1" }]);
		expect(second.requests).toEqual([{ distinctId: "user-1" }]);
	});

	test("in privacy mode no tracer sees what the user or the model wrote", () => {
		const seen = new FakeTracer();
		const tracer = tracing([seen], { privacy: true });

		tracer.turn({
			trace,
			name: "chat turn",
			latencyMs: 10,
			failed: false,
			attributes: { steps: 1 },
			content: { prompt: "buy milk", answer: "done" },
		});
		tracer.span({
			trace,
			name: "repl eval 1",
			latencyMs: 4,
			failed: false,
			content: { input: '(remember "buy milk")', output: "ok" },
		});
		tracer.generation({
			trace,
			name: "agent step",
			latencyMs: 300,
			failed: false,
			usage: { input: 10, output: 2 },
			content: {
				input: [{ role: "user", content: "buy milk" }],
				output: "done",
			},
		});

		const records = [...seen.turns, ...seen.spans, ...seen.generations];
		expect(records).toHaveLength(3);
		expect(JSON.stringify(records)).not.toContain("milk");
		expect(seen.turns[0].attributes).toEqual({ steps: 1 });
		expect(seen.generations[0].usage).toEqual({ input: 10, output: 2 });
	});

	test("in privacy mode an exception keeps its type and stack but not its message", () => {
		const seen = new FakeTracer();
		const tracer = tracing([seen], { privacy: true });
		const error = failing();
		error.name = "NoteError";

		tracer.exception({ error, trace, properties: { steps: 2 } });

		const [record] = seen.exceptions;
		const hidden = record.error as Error;
		expect(hidden).toBeInstanceOf(Error);
		expect(hidden.name).toBe("NoteError");
		expect(hidden.message).not.toContain("milk");
		expect(hidden.stack).not.toContain("milk");
		expect(hidden.stack).toContain("tracer.test.ts");
		expect(record.properties).toEqual({ steps: 2 });
	});

	test("in privacy mode a thrown value that is not an error is hidden too", () => {
		const seen = new FakeTracer();
		const tracer = tracing([seen], { privacy: true });

		tracer.exception({ error: "buy milk", trace, properties: {} });

		expect(String(seen.exceptions[0].error)).not.toContain("milk");
	});

	test("with privacy off an exception reaches the tracer as it was thrown", () => {
		const seen = new FakeTracer();
		const tracer = tracing([seen], { privacy: false });
		const error = failing();

		tracer.exception({ error, trace, properties: {} });

		expect(seen.exceptions[0].error).toBe(error);
	});
});
