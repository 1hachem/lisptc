import { describe, expect, test } from "vitest";
import { ev, evWithOutput } from "./helpers.ts";

describe("format", () => {
	test("nil returns the formatted string", () =>
		expect(ev(`(format nil "~a has ~d steps" "x" 3)`)).toBe(`"x has 3 steps"`));

	test("~a prints a string bare and ~s keeps its quotes", () =>
		expect(ev(`(format nil "~a ~s" "hi" "hi")`)).toBe(`"hi \\"hi\\""`));

	test("~a prints a list as it reads", () =>
		expect(ev(`(format nil "~a" '(1 2))`)).toBe(`"(1 2)"`));

	test("~% is a newline and ~~ a tilde", () =>
		expect(ev(`(format nil "a~%~~b")`)).toBe(`"a\\n~b"`));

	test("~{ ~} loops over a list and ~^ stops before the last separator", () =>
		expect(ev(`(format nil "~{~s~^ ~}" '("a" "b" "c"))`)).toBe(
			`"\\"a\\" \\"b\\" \\"c\\""`,
		));

	test("~{ ~} over an empty list prints nothing", () =>
		expect(ev(`(format nil "[~{~a~^, ~}]" nil)`)).toBe(`"[]"`));

	test("directives are case-insensitive", () =>
		expect(ev(`(format nil "~A~D" "n" 2)`)).toBe(`"n2"`));

	test("t prints the string and returns nil", () =>
		expect(evWithOutput(`(format t "~a done" "all")`)).toEqual({
			value: "nil",
			output: "all done",
		}));

	test("a control string in place of the destination returns the string", () =>
		expect(ev(`(format "~a" 1)`)).toBe(`"1"`));

	test("an unterminated loop is an error", () =>
		expect(() => ev(`(format nil "~{~a" '(1))`)).toThrow(/no closing ~}/));

	test("a destination other than nil or t is an error", () =>
		expect(() => ev(`(format 1 "~a" 2)`)).toThrow(/nil or t/));
});
