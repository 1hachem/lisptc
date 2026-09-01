import { describe, expect, it } from "vitest";
import { checkSyntax, stripProse } from "../src/lisp.ts";
import { ev, evWithOutput } from "./helpers.ts";

describe("prose around forms", () => {
	it("evaluates the forms and ignores the text between them", () => {
		expect(ev("Here we go: (+ 1 2) and that is the answer.")).toBe("3");
		expect(
			ev("First define it.\n(defun sq (x) (* x x))\nThen use it: (sq 5)"),
		).toBe("25");
	});

	it("ignores punctuation that would otherwise be read as code", () => {
		expect(ev("(+ 1 2) happy to help :)")).toBe("3");
		expect(ev("a stray ) close paren is just text (+ 1 2)")).toBe("3");
		expect(ev("don't worry about apostrophes (+ 1 2)")).toBe("3");
	});

	it("evaluates a program with no form at all to nothing", () => {
		expect(ev("just thinking out loud, no code here")).toBe("#<unspecified>");
		expect(ev("")).toBe("#<unspecified>");
	});

	it("treats a bare top-level atom as prose", () => {
		expect(ev("16")).toBe("#<unspecified>");
		expect(ev("no-such-var")).toBe("#<unspecified>");
	});

	it("keeps reader sugar written against a top-level form", () => {
		expect(ev("the list is '(1 2 3)")).toBe("(1 2 3)");
		expect(ev("(setq x 2) quasiquoted: `(1 ,x)")).toBe("(1 2)");
	});

	it("does not read prose punctuation touching a form as sugar", () => {
		expect(stripProse("and then,(+ 1 2)")).toBe("         (+ 1 2)");
	});

	it("does not end a form at a paren inside a string", () => {
		expect(evWithOutput('look: (princ "(not a form)") done').output).toBe(
			"(not a form)",
		);
	});

	it("still reports an unclosed form rather than swallowing it", () => {
		expect(() => ev("here it comes (+ 1 2")).toThrow();
	});

	it("reports syntax errors at their line in the original text", () => {
		expect(checkSyntax("some prose\nmore prose\n(a . )")).toEqual([
			{ message: 'syntax error: unexpected ")" at 3', line: 3 },
		]);
		expect(checkSyntax("prose only, and a smiley :)")).toEqual([]);
	});

	it("blanks prose in place so offsets are preserved", () => {
		expect(stripProse("hi (+ 1 2) bye")).toBe("   (+ 1 2)    ");
		expect(stripProse("one\n(+ 1 2)\ntwo")).toBe("   \n(+ 1 2)\n   ");
	});
});

describe("no comment syntax", () => {
	it("reads `;` as an ordinary symbol character inside a form", () => {
		expect(ev("(progn ';)")).toBe(";");
		expect(() => ev("(list 1 ; 2)")).toThrow(/void variable/);
	});

	it("ignores a `;` line outside a form, like any other prose", () => {
		expect(ev(";; a section header\n(+ 1 2)")).toBe("3");
	});
});
