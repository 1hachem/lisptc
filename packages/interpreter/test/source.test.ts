import { describe, expect, it } from "vitest";
import { runSync } from "../src/lisp.ts";
import { type Cell, newSym } from "../src/objects.ts";
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

	it("keeps the last definition that succeeded", () => {
		const interp = freshInterp();
		runSync(interp, "(defun sq (x) (* x x))");
		expect(() => runSync(interp, "(defun sq (1) 1)")).toThrow();
		expect(str(interp.sourceOf("sq"))).toBe("(defun sq (x) (* x x))");
	});

	it("is dropped when the name is rebound by setq", () => {
		const interp = freshInterp();
		runSync(interp, "(defun sq (x) (* x x))");
		runSync(interp, "(setq sq 3)");
		expect(interp.sourceOf("sq")).toBeUndefined();
	});

	it("is dropped when the global is removed", () => {
		const interp = freshInterp();
		runSync(interp, "(defun sq (x) (* x x))");
		interp.undefineGlobal(newSym("sq"));
		expect(interp.sourceOf("sq")).toBeUndefined();
	});

	it("is not changed by mutating what a read returned", () => {
		const interp = freshInterp();
		runSync(interp, "(defun sq (x) (* x x))");
		(interp.sourceOf("sq") as Cell).car = 0;
		expect(str(interp.sourceOf("sq"))).toBe("(defun sq (x) (* x x))");
	});

	it("is absent for a builtin", () => {
		expect(freshInterp().sourceOf("car")).toBeUndefined();
	});
});
