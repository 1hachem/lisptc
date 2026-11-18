import { describe, expect, it } from "vitest";
import { tolerantly, unrunSpans } from "./helpers.ts";

describe("what a step left unrun", () => {
	it("spans the aside it read as prose, and leaves the form it ran alone", () => {
		expect(unrunSpans("an aside (see below)\n(+ 1 2)")).toEqual([[9, 20]]);
	});

	it("tells two forms with the same head apart", () => {
		const text = "(I will check (the thing)) (I will check (+ 1 2))";
		expect(unrunSpans(text)).toEqual([
			[0, 26],
			[27, 41],
			[48, 49],
		]);
		expect(text.slice(41, 48)).toBe("(+ 1 2)");
	});

	it("spans a form it could not read", () => {
		expect(unrunSpans("Working on (echo 1")).toEqual([[11, 18]]);
	});

	it("says nothing about a reply that is all prose", () => {
		expect(unrunSpans("The answer is 42.")).toEqual([]);
	});
});

describe("a call the model wrote inside its prose", () => {
	it("runs, and the prose around it does not dim it", () => {
		const text = "(hello this is lisp (echo 1))";
		expect(unrunSpans(text)).toEqual([
			[0, 20],
			[28, 29],
		]);
		expect(text.slice(20, 28)).toBe("(echo 1)");
	});

	it("is found however deep the prose buries it", () => {
		const text = '(I checked (the result of (echo "deep")))';
		expect(unrunSpans(text)).toEqual([
			[0, 26],
			[39, 41],
		]);
		expect(text.slice(26, 39)).toBe('(echo "deep")');
	});

	it("is not claimed at all when no words surround the call", () => {
		expect(unrunSpans("(fetch (car urls))")).toEqual([]);
	});
});

describe("running the call the prose buried", () => {
	it("runs it and notes the aside around it once", () => {
		const { output, skipped } = tolerantly("(hello this is lisp (echo 1))");
		expect(output).toBe("1\n");
		expect(skipped).toHaveLength(1);
	});

	it("reaches a call the prose buried two deep", () => {
		const { output } = tolerantly('(I checked (the result of (echo "deep")))');
		expect(output).toContain("deep");
	});

	it("leaves a mistyped call to error", () => {
		expect(() => tolerantly("(fetch (car urls))")).toThrow("undefined: fetch");
	});
});
