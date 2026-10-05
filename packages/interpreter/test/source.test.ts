import { describe, expect, it } from "vitest";
import { runSync } from "../src/lisp.ts";
import { str } from "../src/print.ts";
import { freshInterp } from "./helpers.ts";

describe("a definition's source", () => {
	it("is recorded by defun and defmacro", () => {
		const interp = freshInterp();
		runSync(interp, '(defun sq (x) "Square." (* x x))');
		runSync(interp, "(defmacro twice (x) `(progn ,x ,x))");
		expect(str(interp.sourceOf("sq"))).toBe('(defun sq (x) "Square." (* x x))');
		expect(str(interp.sourceOf("twice"))).toBe(
			"(defmacro twice (x) `(progn ,x ,x))",
		);
	});

	it("is absent for a builtin", () => {
		expect(freshInterp().sourceOf("car")).toBeUndefined();
	});
});
