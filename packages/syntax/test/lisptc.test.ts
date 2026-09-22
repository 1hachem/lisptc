import { FORM_FIXTURES } from "@repo/shared/lisp-form-fixtures";
import { describe, expect, test } from "vitest";
import {
	type FormSpan,
	formsIn,
	highlighter,
	openForms,
	tokensIn,
} from "../src/index.ts";

function tokens(text: string): [string, string | undefined][] {
	return highlighter
		.tokenize(text, { lang: "lisptc" })
		.tokens.filter((t) => t.value.trim() !== "")
		.map((t) => [t.value, t.className]);
}

describe("reading lisptc", () => {
	test("the tokens put the text back together", () => {
		const text = 'hello (echo "hi" 42 :loud) there\n\n(+ 1 2)';
		expect(
			highlighter
				.tokenize(text, { lang: "lisptc" })
				.tokens.map((t) => t.value)
				.join(""),
		).toBe(text);
	});

	test("the head of a form reads apart from its arguments", () => {
		expect(tokens('(echo "hi" 42 :loud x)')).toEqual([
			["(", "operator"],
			["echo", "function"],
			['"hi"', "string"],
			["42", "number"],
			[":loud", "attr"],
			["x", "variable"],
			[")", "operator"],
		]);
	});

	test("text around a form is prose, as the reader sees it", () => {
		expect(tokens("summing them (+ 1 2) gives three")).toEqual([
			["summing them ", undefined],
			["(", "operator"],
			["+", "function"],
			["1", "number"],
			["2", "number"],
			[")", "operator"],
			[" gives three", undefined],
		]);
	});

	test("parenthesized prose stays unhighlighted", () => {
		expect(tokens("Choose this (Best for quick tests) today")).toEqual([
			["Choose this (Best for quick tests) today", undefined],
		]);
	});

	test("a paren inside a string stays in the string", () => {
		expect(tokens('(echo "a ( b")')).toEqual([
			["(", "operator"],
			["echo", "function"],
			['"a ( b"', "string"],
			[")", "operator"],
		]);
	});

	test("a smiley in prose is not a form that closed", () => {
		expect(tokens("prose only, and a smiley :)")).toEqual([
			["prose only, and a smiley :)", undefined],
		]);
	});

	test("the language answers to the names a fence is written with", () => {
		expect(highlighter.normalizeLanguage("lisp")).toBe("lisptc");
		expect(highlighter.normalizeLanguage("ptc")).toBe("lisptc");
	});

	test("the editor waits on the parens the repl is still holding", () => {
		expect(openForms("(a (b")).toBe(2);
		expect(openForms("(a (b))")).toBe(0);
	});

	test("an unterminated string colours to the end of its line", () => {
		expect(tokens('(echo "hi\n(+ 1 2)')).toEqual([
			["(", "operator"],
			["echo", "function"],
			['"hi', "string"],
			["(", "operator"],
			["+", "function"],
			["1", "number"],
			["2", "number"],
			[")", "operator"],
		]);
	});

	test("a quote belongs to the paren it was written against, and quotes the call out of it", () => {
		expect(tokens("'(a b)")).toEqual([
			["'(", "operator"],
			["a", "variable"],
			["b", "variable"],
			[")", "operator"],
		]);
	});
});

function classed(text: string, skipped: FormSpan[] = []): string[] {
	return tokensIn(text, skipped)
		.filter((t) => t.className !== undefined)
		.map((t) => t.value);
}

describe("what the repl skipped as prose", () => {
	test("loses the highlighting, while the forms it ran keep theirs", () => {
		expect(classed("an aside (see below)\n(+ 1 2)", [[9, 20]])).toEqual([
			"(",
			"+",
			"1",
			"2",
			")",
		]);
	});

	test("reads as a call again without the hint", () => {
		expect(classed("an aside (see below)")).toEqual(["(", "see", "below", ")"]);
	});

	test("takes the calls nested inside it down with it", () => {
		expect(classed("(I will check (the thing)) (echo 1)", [[0, 26]])).toEqual([
			"(",
			"echo",
			"1",
			")",
		]);
	});

	test("obeys the span over a call it can see inside it", () => {
		expect(classed("(I will check (echo 1)) (echo 2)", [[0, 23]])).toEqual([
			"(",
			"echo",
			"2",
			")",
		]);
	});

	test("still puts the text back together", () => {
		const text = "an aside (see below)\n(+ 1 2)";
		expect(
			tokensIn(text, [[9, 20]])
				.map((t) => t.value)
				.join(""),
		).toBe(text);
	});
});

describe("formsIn", () => {
	test("separates the prose a reply carries from the forms it runs", () => {
		const { prose, heads } = formsIn(
			'Let me look.\n(load-mcp "playwright")\nThen I will read it.',
		);
		expect(prose).toBe("Let me look.\n\nThen I will read it.");
		expect(heads).toEqual(["load-mcp"]);
	});

	test("names every call a form makes, not just the outermost", () => {
		expect(formsIn('(echo (grep issues "auth"))').heads).toEqual([
			"echo",
			"grep",
		]);
	});

	test("names a call once however often it is made", () => {
		expect(formsIn("(echo 1) (echo 2) (echo 3)").heads).toEqual(["echo"]);
	});

	test("reads a form the model is still writing", () => {
		const { prose, heads } = formsIn('Working on it.\n(load-mcp "playw');
		expect(prose).toBe("Working on it.");
		expect(heads).toEqual(["load-mcp"]);
	});

	test("takes no call out of a parenthesis inside a string", () => {
		expect(formsIn('(echo "(not-a-call 1)")').heads).toEqual(["echo"]);
	});

	test("shows an aside the repl read as prose verbatim, and runs no tool for it", () => {
		const reply = "an aside (see below)\n(+ 1 2)";
		const { prose, heads } = formsIn(reply, [[9, 20]]);
		expect(heads).toEqual(["+"]);
		expect(prose).toBe("an aside (see below)");
	});

	test("reads an ambiguous parenthesis as a call without a skipped-head hint", () => {
		expect(formsIn("an aside (see below)\n(+ 1 2)").heads).toEqual([
			"see",
			"+",
		]);
	});

	test("keeps a skipped aside's nested calls out of the tools too", () => {
		const { heads } = formsIn("(I will check (the thing)) (echo 1)", [[0, 26]]);
		expect(heads).toEqual(["echo"]);
	});

	test("leaves a reply that is all prose alone", () => {
		const { prose, heads } = formsIn("The answer is 42.");
		expect(prose).toBe("The answer is 42.");
		expect(heads).toEqual([]);
	});
});

describe("the browser reads a reply the way the repl runs it", () => {
	test.each(FORM_FIXTURES)("names the calls of $source", ({
		source,
		heads,
	}) => {
		expect(formsIn(source).heads).toEqual(heads);
	});

	test.each(FORM_FIXTURES)("takes the forms of $source out of the prose", ({
		source,
		forms,
	}) => {
		const { prose } = formsIn(source);
		for (const form of forms) expect(prose).not.toContain(form);
	});
});
