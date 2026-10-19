import { describe, expect, it } from "vitest";
import { FORM_FIXTURES } from "../src/lisp-form-fixtures.ts";
import {
	formSpans,
	formsOnly,
	openAtEnd,
	openForms,
} from "../src/lisp-forms.ts";

describe("one scanner decides where a form starts and ends", () => {
	it.each(FORM_FIXTURES)("finds the forms of $source", ({ source, forms }) => {
		const spans = formSpans(source);
		expect(spans.map(([start, end]) => source.slice(start, end))).toEqual(
			forms,
		);
	});

	it.each(FORM_FIXTURES)("blanks the prose of $source", ({ source }) => {
		const only = formsOnly(source);
		expect(only).toHaveLength(source.length);
		let left = only;
		for (const [start, end] of formSpans(source)) {
			expect(only.slice(start, end)).toBe(source.slice(start, end));
			left = left.slice(0, start) + " ".repeat(end - start) + left.slice(end);
		}
		expect(left.trim()).toBe("");
	});
});

describe("open forms count what is still waiting to be closed", () => {
	it("counts the parens a reader would still be holding", () => {
		expect(openForms("(a (b")).toBe(2);
		expect(openForms("(a (b))")).toBe(0);
		expect(openForms('(echo "((")')).toBe(0);
		expect(openForms("(a))")).toBe(0);
	});

	it("does not close a form on a paren the reader never saw", () => {
		expect(openForms("(defun add (a b)")).toBe(1);
		expect(openForms('(echo "hi')).toBe(1);
	});

	it("says where each open form starts and whether the text ends in a string", () => {
		expect(openAtEnd('(a "(" (b')).toEqual({ parens: [0, 7], inString: false });
		expect(openAtEnd('(load-mcp "gi')).toEqual({
			parens: [0],
			inString: true,
		});
		expect(openAtEnd('(echo "a")')).toEqual({ parens: [], inString: false });
		expect(openAtEnd('say "(hi')).toEqual({ parens: [5], inString: false });
	});

	it("ends a string at the line it opened on, as the reader does", () => {
		expect(openAtEnd('(echo "a\n')).toEqual({ parens: [0], inString: false });
	});
});
