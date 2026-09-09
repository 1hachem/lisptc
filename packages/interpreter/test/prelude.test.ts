import { describe, expect, it } from "vitest";
import { Interp, prelude, runSync } from "../src/lisp.ts";
import { ev, freshInterp } from "./helpers.ts";

describe("prelude", () => {
	it("loads into a fresh interpreter without error", () => {
		const interp = new Interp();
		expect(() => runSync(interp, prelude)).not.toThrow();
	});

	it("defines the standard bindings", () => {
		const names = freshInterp().globalNames();
		for (const name of [
			"defun",
			"defmacro",
			"let",
			"let*",
			"letrec",
			"if",
			"when",
			"and",
			"or",
			"append",
			"mapcar",
			"nth",
			"cadr",
			"equal",
			"not",
			"nreverse",
		])
			expect(names).toContain(name);
	});

	it("supports defun nested inside a lambda (letrec expansion)", () => {
		expect(
			ev(
				"(letrec ((f (lambda (n) (cond ((eq n 0) 1) (t (* n (f (- n 1)))))))) (f 5))",
			),
		).toBe("120");
	});
});
