import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import { type Lisptc, loadLisptc, type SpanKind } from "../src/lisptc.ts";

let lisptc: Lisptc;

beforeAll(async () => {
	const wasm = await readFile(
		fileURLToPath(new URL("../src/lisptc.wasm", import.meta.url)),
	);
	lisptc = await loadLisptc({ grammar: wasm });
});

function kinds(text: string): [string, SpanKind][] {
	return lisptc
		.read(text)
		.spans.filter((s) => s.text.trim() !== "")
		.map((s) => [s.text, s.kind]);
}

describe("reading lisptc", () => {
	test("the spans put the text back together", () => {
		const text = 'hello (echo "hi" 42 :loud) there\n\n(+ 1 2)';
		expect(
			lisptc
				.read(text)
				.spans.map((s) => s.text)
				.join(""),
		).toBe(text);
	});

	test("the head of a form reads apart from its arguments", () => {
		expect(kinds('(echo "hi" 42 :loud x)')).toEqual([
			["(", "delimiter"],
			["echo", "head"],
			['"hi"', "string"],
			["42", "number"],
			[":loud", "keyword"],
			["x", "symbol"],
			[")", "delimiter"],
		]);
	});

	test("text around a form is prose, as the reader sees it", () => {
		expect(kinds("summing them (+ 1 2) gives three")).toEqual([
			["summing them", "prose"],
			["(", "delimiter"],
			["+", "head"],
			["1", "number"],
			["2", "number"],
			[")", "delimiter"],
			["gives three", "prose"],
		]);
	});

	test("a paren inside a string stays in the string", () => {
		expect(kinds('(echo "a ( b")')).toEqual([
			["(", "delimiter"],
			["echo", "head"],
			['"a ( b"', "string"],
			[")", "delimiter"],
		]);
	});

	test("open forms count what is still waiting to be closed", () => {
		expect(lisptc.read("(a (b").openForms).toBe(2);
		expect(lisptc.read("(a (b))").openForms).toBe(0);
		expect(lisptc.read('(echo "((")').openForms).toBe(0);
		expect(lisptc.read("(a))").openForms).toBe(0);
	});

	test("a close the parser only guessed at does not close a form", () => {
		expect(lisptc.read("(defun add (a b)").openForms).toBe(1);
		expect(lisptc.read('(echo "hi').openForms).toBe(1);
	});

	test("a quote belongs to the paren it was written against", () => {
		expect(kinds("'(a b)")).toEqual([
			["'(", "delimiter"],
			["a", "head"],
			["b", "symbol"],
			[")", "delimiter"],
		]);
	});
});
