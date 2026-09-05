import { describe, expect, it } from "vitest";
import { LISP_GRAMMAR } from "../src/grammar.ts";
import { checkSyntax } from "../src/lisp.ts";
import { LANGUAGE_REFERENCE } from "../src/source.ts";
import { accepts, parseGrammar } from "./gbnf.ts";
import { ev } from "./helpers.ts";

// Replies in the shape an agent actually writes them once the prompt tells it
// prose is allowed: a sentence of explanation wrapped around the forms doing
// the work. Each surface the model meets — the GBNF that constrains its
// decoding, the syntax check the editor runs, and the evaluator itself — has
// to agree on every one of them, which is what this corpus pins down.
const REPLIES: [source: string, value: string][] = [
	["Let me square it: (* 5 5)", "25"],
	["(+ 1 2) and that is the answer.", "3"],
	["Sure! Adding them now.\n(+ 1 2)\nDone.", "3"],
	["First define it.\n(defun sq (x) (* x x))\n\nNow use it: (sq 5)", "25"],
	["step 1. (setq x 2) step 2. (* x 3)", "6"],
	["don't worry about apostrophes (+ 1 2)", "3"],
	['a remark; with a semicolon, then (echo "") (+ 1 2)', "3"],
	['prose may hold a lone " quote (+ 1 2)', "3"],
	["a 50% discount, path/to/file, 3 > 2 — all prose (+ 1 2)", "3"],
	["emoji are prose too 🎉 (+ 1 2)", "3"],
	["the list is '(1 2 3)", "(1 2 3)"],
	["(setq x 2) quasiquoted: `(1 ,x)", "(1 2)"],
];

describe("prose is allowed on every surface the model meets", () => {
	const grammar = parseGrammar(LISP_GRAMMAR);

	it.each(REPLIES)("the GBNF lets the model write %j", (source) => {
		expect(accepts(grammar, source)).toBe(true);
	});

	it.each(REPLIES)("the reader finds no syntax error in %j", (source) => {
		expect(checkSyntax(source)).toEqual([]);
	});

	it.each(
		REPLIES,
	)("%j evaluates to the value of its last form", (src, value) => {
		expect(ev(src)).toBe(value);
	});
});

describe("the language reference teaches prose", () => {
	// The reference IS the system prompt's language section (source.ts embeds
	// SKILL.md verbatim), so a model that never sees these two rules will keep
	// writing `;` comments and bare top-level atoms.
	it("says the text around the forms is ignored", () => {
		expect(LANGUAGE_REFERENCE).toMatch(
			/only the parenthesised top-level forms are program text/i,
		);
	});

	it("says there is no comment syntax", () => {
		expect(LANGUAGE_REFERENCE).toMatch(/there is no comment syntax/i);
	});

	// The GBNF fences "<" and "[" out of prose so no model can open a thinking
	// channel there. A model that is never told will just spend tokens being
	// masked, so the reference has to carry the rule too.
	it("says prose cannot hold a < or a [", () => {
		expect(LANGUAGE_REFERENCE).toMatch(/prose cannot hold a `<` or a `\[`/i);
	});
});

describe("the language reference teaches context compression", () => {
	// The silence is invisible unless the reference describes it: a model that
	// is not told will wait for values it will never be shown, and will keep
	// retyping data it could have referred to by name.
	it("says the REPL prints nothing on its own", () => {
		expect(LANGUAGE_REFERENCE).toMatch(/the ONLY thing that prints/);
		expect(LANGUAGE_REFERENCE).toMatch(/reports? (one line|a result's name)/i);
	});

	it("says every result is bound to a name", () => {
		expect(LANGUAGE_REFERENCE).toMatch(/never retype data the REPL/i);
	});

	// The whole point of the split: reaching for `grep` instead of copying a
	// URL out of a printout.
	it("says the extraction commands return rather than print", () => {
		expect(LANGUAGE_REFERENCE).toMatch(/RETURN a value/);
		expect(LANGUAGE_REFERENCE).toMatch(/head`\/`tail`\/`grep` RETURN a value/);
	});

	it("says a truncated echo is not the whole output", () => {
		expect(LANGUAGE_REFERENCE).toMatch(
			/capped for you.{0,20}not for the user/i,
		);
		expect(LANGUAGE_REFERENCE).toMatch(/read on with/i);
	});
});
