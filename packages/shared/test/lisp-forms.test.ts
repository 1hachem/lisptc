import { describe, expect, it } from "vitest";
import { FORM_FIXTURES } from "../src/lisp-form-fixtures.ts";
import { formSpans, formsOnly, openForms } from "../src/lisp-forms.ts";

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
});
