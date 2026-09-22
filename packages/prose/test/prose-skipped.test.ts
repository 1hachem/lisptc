import { describe, expect, it } from "vitest";
import { proseSkipped } from "../src/prose.ts";
import { proseInterp, tolerantly } from "./helpers.ts";

describe("what a step left unrun", () => {
	it("spans the aside it read as prose, and leaves the form it ran alone", () => {
		expect(
			proseSkipped(proseInterp(), "an aside (see below)\n(+ 1 2)"),
		).toEqual([{ span: [9, 20], reason: '"see" is not defined' }]);
	});

	it("tells two forms with the same head apart", () => {
		const text = "(I will check (the thing)) (I will check (+ 1 2))";
		expect(proseSkipped(proseInterp(), text)).toEqual([
			{ span: [0, 26], reason: '"I" is not defined' },
			{ span: [27, 41], reason: '"I" is not defined' },
			{ span: [48, 49], reason: '"I" is not defined' },
		]);
		expect(text.slice(41, 48)).toBe("(+ 1 2)");
	});

	it("spans a form it could not read", () => {
		const [only, ...rest] = proseSkipped(proseInterp(), "Working on (echo 1");
		expect(rest).toEqual([]);
		expect(only.span).toEqual([11, 18]);
		expect(only.reason).toContain("unexpected end of input");
	});

	it("says nothing about a reply that is all prose", () => {
		expect(proseSkipped(proseInterp(), "The answer is 42.")).toEqual([]);
	});
});

describe("a call the model wrote inside its prose", () => {
	it("runs, and the prose around it does not dim it", () => {
		const text = "(hello this is lisp (echo 1))";
		expect(proseSkipped(proseInterp(), text)).toEqual([
			{ span: [0, 20], reason: '"hello" is not defined' },
			{ span: [28, 29], reason: '"hello" is not defined' },
		]);
		expect(text.slice(20, 28)).toBe("(echo 1)");
	});

	it("is found however deep the prose buries it", () => {
		const text = '(I checked (the result of (echo "deep")))';
		const spans = proseSkipped(proseInterp(), text).map((s) => s.span);
		expect(spans).toEqual([
			[0, 26],
			[39, 41],
		]);
		expect(text.slice(26, 39)).toBe('(echo "deep")');
	});

	it("is not claimed at all when no words surround the call", () => {
		expect(proseSkipped(proseInterp(), "(fetch (car urls))")).toEqual([]);
	});
});

describe("running the call the prose buried", () => {
	it("runs it and says so", () => {
		const { output, skipped } = tolerantly("(hello this is lisp (echo 1))");
		expect(output).toContain("1");
		expect(skipped).toEqual([
			'(hello this is lisp (echo 1)) — "hello" is not defined, so this was read as prose, and the form inside it ran',
		]);
	});

	it("reaches a call the prose buried two deep", () => {
		const { output } = tolerantly('(I checked (the result of (echo "deep")))');
		expect(output).toContain("deep");
	});

	it("leaves a mistyped call to error", () => {
		expect(() => tolerantly("(fetch (car urls))")).toThrow("undefined: fetch");
	});
});
