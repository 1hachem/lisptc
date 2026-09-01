import { describe, expect, it } from "vitest";
import {
	collectCalls,
	parseForms,
	tokenizeWithPositions,
} from "../src/tokenize.ts";

describe("tokenizeWithPositions", () => {
	it("tokenizes a simple form with (line, char) positions", () => {
		const tokens = tokenizeWithPositions("(foo bar)");
		expect(tokens).toEqual([
			{ kind: "atom", text: "(", line: 0, char: 0 },
			{ kind: "atom", text: "foo", line: 0, char: 1 },
			{ kind: "atom", text: "bar", line: 0, char: 5 },
			{ kind: "atom", text: ")", line: 0, char: 8 },
		]);
	});

	it("tracks line numbers across a multi-line program", () => {
		const tokens = tokenizeWithPositions("(foo\n  bar)");
		expect(tokens.map((t) => [t.text, t.line, t.char])).toEqual([
			["(", 0, 0],
			["foo", 0, 1],
			["bar", 1, 2],
			[")", 1, 5],
		]);
	});

	it("keeps a quoted string (with an escaped quote) as one token", () => {
		const tokens = tokenizeWithPositions('(foo "a \\"b\\" c")');
		expect(tokens.map((t) => t.text)).toEqual([
			"(",
			"foo",
			'"a \\"b\\" c"',
			")",
		]);
	});

	it("reads `;` as an ordinary symbol char — there is no comment syntax", () => {
		const tokens = tokenizeWithPositions("(foo) ;not-a-comment\n(bar)");
		expect(tokens.map((t) => t.text)).toEqual([
			"(",
			"foo",
			")",
			";not-a-comment",
			"(",
			"bar",
			")",
		]);
	});

	it("tokenizes reader sugar as its own token", () => {
		const tokens = tokenizeWithPositions("'(a ,@b) `c ,d");
		expect(tokens.map((t) => t.text)).toEqual([
			"'",
			"(",
			"a",
			",@",
			"b",
			")",
			"`",
			"c",
			",",
			"d",
		]);
	});
});

describe("parseForms", () => {
	it("nests list forms and records their open/close positions", () => {
		const forms = parseForms(tokenizeWithPositions("(a (b c))"));
		expect(forms).toHaveLength(1);
		const [outer] = forms;
		if (outer.kind !== "list") throw new Error("expected a list");
		expect(outer.openChar).toBe(0);
		expect(outer.closeChar).toBe(8);
		expect(
			outer.items.map((n) => (n.kind === "atom" ? n.text : "<list>")),
		).toEqual(["a", "<list>"]);
		const inner = outer.items[1];
		if (inner.kind !== "list") throw new Error("expected a nested list");
		expect(inner.items.map((n) => (n.kind === "atom" ? n.text : n))).toEqual([
			"b",
			"c",
		]);
	});

	it("collapses quote sugar into the one form it prefixes", () => {
		const forms = parseForms(tokenizeWithPositions("(foo 'x ,@y)"));
		const [call] = forms;
		if (call.kind !== "list") throw new Error("expected a list");
		// 'x and ,@y each collapse to one node, not two, so foo has 3 items total
		// (itself plus the two collapsed args), not 5.
		expect(call.items).toHaveLength(3);
		expect(call.items.map((n) => (n.kind === "atom" ? n.text : n))).toEqual([
			"foo",
			"x",
			"y",
		]);
	});

	it("is best-effort on a stray unmatched close paren", () => {
		expect(() => parseForms(tokenizeWithPositions("(foo))"))).not.toThrow();
	});
});

describe("collectCalls", () => {
	it("collects a top-level call and its nested calls", () => {
		const calls = collectCalls(
			parseForms(tokenizeWithPositions("(foo (bar 1))")),
		);
		expect(calls.map((c) => c.name)).toEqual(["foo", "bar"]);
	});

	it("separates :keyword args from positional argCount", () => {
		const [call] = collectCalls(
			parseForms(tokenizeWithPositions('(browser_navigate :url "x" 1 2)')),
		);
		expect(call.name).toBe("browser_navigate");
		expect(call.keywords).toEqual(new Set(["url"]));
		expect(call.argCount).toBe(4);
	});

	it("does not count a nested call's own :keywords against the outer call", () => {
		const calls = collectCalls(
			parseForms(tokenizeWithPositions("(outer (inner :k 1))")),
		);
		const outer = calls.find((c) => c.name === "outer");
		const inner = calls.find((c) => c.name === "inner");
		expect(outer?.keywords.size).toBe(0);
		expect(inner?.keywords).toEqual(new Set(["k"]));
	});

	it("does not inflate argCount for a quoted argument", () => {
		const [call] = collectCalls(parseForms(tokenizeWithPositions("(foo 'x)")));
		expect(call.argCount).toBe(1);
	});

	it("records the head token's own position for diagnostics ranges", () => {
		const [call] = collectCalls(parseForms(tokenizeWithPositions("  (foo 1)")));
		expect(call.head).toEqual({ kind: "atom", text: "foo", line: 0, char: 3 });
	});
});
