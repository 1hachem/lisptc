import { describe, expect, it } from "vitest";
import { Interp, prelude, run } from "../src/lisp.ts";
import { ev, freshInterp } from "./helpers.ts";

describe("prelude", () => {
	it("loads into a fresh interpreter without error", () => {
		const interp = new Interp();
		expect(() => run(interp, prelude)).not.toThrow();
	});

	it("defines the standard bindings", () => {
		const names = freshInterp().globalNames();
		for (const name of [
			"defun",
			"defmacro",
			"let",
			"letrec",
			"if",
			"when",
			"and",
			"or",
			"append",
			"mapcar",
			"cadr",
			"equal",
			"not",
			"nreverse",
		])
			expect(names).toContain(name);
	});

	it("supports defun nested inside a lambda (letrec expansion)", () => {
		// Regression check: the defun expansion calls _set-doc with the
		// compiled local variable (an Arg, not a Sym) in this position.
		expect(
			ev(
				"(letrec ((f (lambda (n) (cond ((eq n 0) 1) (t (* n (f (- n 1)))))))) (f 5))",
			),
		).toBe("120");
	});
});
