import { describe, expect, it } from "vitest";
import { type CallDoc, callDiagnostics } from "../src/call-diagnostics.ts";

function problems(text: string, docs: Record<string, CallDoc>): string[] {
	return callDiagnostics(text, new Map(Object.entries(docs))).map(
		(d) => d.message,
	);
}

const takes = (min: number, max = min): CallDoc => ({ arity: { min, max } });

describe("the calls read off a text", () => {
	it("tracks line numbers across a multi-line program", () => {
		const [problem] = callDiagnostics(
			"(foo\n  (bar 1))",
			new Map([["bar", takes(0)]]),
		);
		expect(problem.range).toEqual({
			start: { line: 1, character: 3 },
			end: { line: 1, character: 6 },
		});
	});

	it("keeps a quoted string (with an escaped quote) as one argument", () => {
		expect(problems('(foo "a \\"b\\" c")', { foo: takes(1) })).toEqual([]);
	});

	it("counts `;` as an ordinary symbol, since there is no comment syntax", () => {
		expect(problems("(foo ;not-a-comment 1)", { foo: takes(2) })).toEqual([]);
	});

	it("collapses quote sugar into the one argument it prefixes", () => {
		expect(problems("(foo 'x ,@y `z ,w)", { foo: takes(4) })).toEqual([]);
	});

	it("still checks a call followed by a stray unmatched close paren", () => {
		expect(problems("(foo 1))", { foo: takes(0) })).toEqual([
			"foo: expected 0 arguments, got 1",
		]);
	});

	it("checks a top-level call and its nested calls", () => {
		expect(problems("(foo (bar 1))", { foo: takes(5), bar: takes(5) })).toEqual(
			["foo: expected 5 arguments, got 1", "bar: expected 5 arguments, got 1"],
		);
	});

	it("counts a :keyword as supplied, and its value toward the argument count", () => {
		const call = '(browser_navigate :url "x" 1 2)';
		expect(
			problems(call, {
				browser_navigate: {
					args: [
						{ name: "url", type: "string", required: true },
						{ name: "name", type: "string", required: true },
					],
				},
			}),
		).toEqual(['browser_navigate: missing required argument ":name"']);
		expect(problems(call, { browser_navigate: takes(0, 3) })).toEqual([
			"browser_navigate: expected 0-3 arguments, got 4",
		]);
	});

	it("does not count a nested call's own :keywords against the outer call", () => {
		const needsK: CallDoc = {
			args: [{ name: "k", type: "string", required: true }],
		};
		expect(
			problems("(outer (inner :k 1))", { outer: needsK, inner: needsK }),
		).toEqual(['outer: missing required argument ":k"']);
	});

	it("does not inflate the argument count for a quoted argument", () => {
		expect(problems("(foo 'x)", { foo: takes(1) })).toEqual([]);
	});

	it("marks the head token's own position", () => {
		const [problem] = callDiagnostics(
			"  (foo 1)",
			new Map([["foo", takes(0)]]),
		);
		expect(problem.range).toEqual({
			start: { line: 0, character: 3 },
			end: { line: 0, character: 6 },
		});
	});
});
