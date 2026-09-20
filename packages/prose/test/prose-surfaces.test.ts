import { LANGUAGE_REFERENCE } from "@repo/interpreter/source";
import { describe, expect, it } from "vitest";
import { checkSyntax } from "../src/prose.ts";
import { evProse } from "./helpers.ts";

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
	it.each(REPLIES)("the reader finds no syntax error in %j", (source) => {
		expect(checkSyntax(source)).toEqual([]);
	});

	it.each(
		REPLIES,
	)("%j evaluates to the value of its last form", (src, value) => {
		expect(evProse(src)).toBe(value);
	});
});

describe("the language reference teaches prose", () => {
	it("says the text around the forms is ignored", () => {
		expect(LANGUAGE_REFERENCE).toMatch(
			/only the parenthesised top-level forms are program text/i,
		);
	});

	it("says there is no comment syntax", () => {
		expect(LANGUAGE_REFERENCE).toMatch(/there is no comment syntax/i);
	});
});
