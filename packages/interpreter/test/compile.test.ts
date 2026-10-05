import { describe, expect, it } from "vitest";
import { ev } from "./helpers.ts";

describe("compiling a lambda: its argument list", () => {
	it("needs an argument list and a body", () => {
		expect(() => ev("(lambda)")).toThrow(/arglist and body expected/);
		expect(() => ev("(lambda 5 1)")).toThrow(/arglist expected: 5/);
	});

	it("needs a variable after &rest", () => {
		expect(() => ev("(lambda (&rest) 1)")).toThrow(/variable expected: nil/);
		expect(() => ev("(lambda (&rest &rest) 1)")).toThrow(
			/variable expected: &rest/,
		);
	});

	it("refuses a second variable after &rest", () => {
		expect(() => ev("(lambda (&rest a b) 1)")).toThrow(/2nd rest: b/);
	});

	it("refuses a name bound twice", () => {
		expect(() => ev("(lambda (a a) 1)")).toThrow(/duplicated argument name/);
	});
});

describe("compiling a lambda: its body", () => {
	it("refuses a malformed quasiquote", () => {
		expect(() => ev("(lambda () (quasiquote))")).toThrow(/bad quasiquote/);
		expect(() => ev("(lambda () (quasiquote a b))")).toThrow(/bad quasiquote/);
	});

	it("refuses a macro defined inside it", () => {
		expect(() => ev("(lambda () (macro (x) x))")).toThrow(/nested macro/);
	});

	it.each([
		"(try)",
		"(try 1)",
		"(try 1 5)",
		"(try 1 (oops e))",
		"(try 1 (catch e) 2)",
		"(try 1 (catch))",
	])("refuses the malformed %s", (form) => {
		expect(() => ev(`(lambda () ${form})`)).toThrow(/bad try/);
	});

	it("leaves an unquote that names no argument as it was", () => {
		expect(ev("(progn (setq y 1) ((lambda (x) `(a ,y)) 2))")).toBe("(a 1)");
	});

	it("binds no argument inside a nested quasiquote", () => {
		expect(ev("(progn (setq y 1) ((lambda (x) `(a `(b ,x ,y))) 2))")).toBe(
			"(a `(b ,x ,y))",
		);
	});
});

describe("calling a lambda with keywords", () => {
	it("refuses a keyword it does not accept", () => {
		expect(() => ev("((lambda (&key a) a) :b 1)")).toThrow(
			/no such keyword argument: :b/,
		);
	});
});
