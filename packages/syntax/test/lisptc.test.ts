import { describe, expect, test } from "vitest";
import { formsIn, highlighter, openForms } from "../src/index.ts";

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

	test("open forms count what is still waiting to be closed", () => {
		expect(openForms("(a (b")).toBe(2);
		expect(openForms("(a (b))")).toBe(0);
		expect(openForms('(echo "((")')).toBe(0);
		expect(openForms("(a))")).toBe(0);
	});

	test("a close the parser only guessed at does not close a form", () => {
		expect(openForms("(defun add (a b)")).toBe(1);
		expect(openForms('(echo "hi')).toBe(1);
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

	test("a quote belongs to the paren it was written against", () => {
		expect(tokens("'(a b)")).toEqual([
			["'(", "operator"],
			["a", "function"],
			["b", "variable"],
			[")", "operator"],
		]);
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

	test("leaves a reply that is all prose alone", () => {
		const { prose, heads } = formsIn("The answer is 42.");
		expect(prose).toBe("The answer is 42.");
		expect(heads).toEqual([]);
	});
});
