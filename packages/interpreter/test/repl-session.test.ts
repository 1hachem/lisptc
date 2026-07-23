import { describe, expect, it } from "vitest";
import { ReplSession } from "../src/lisp.ts";

describe("ReplSession (in-process REPL binding)", () => {
	it("returns the value of the last form", () => {
		const r = new ReplSession();
		expect(r.eval("(+ 1 2)")).toBe("3\n");
	});

	it("persists definitions across eval calls", () => {
		const r = new ReplSession();
		r.eval("(defun sq (x) (* x x))");
		expect(r.eval("(sq 5)")).toBe("25\n");
	});

	it("captures side-effect output before the value", () => {
		const r = new ReplSession();
		expect(r.eval('(progn (princ "hi") 42)')).toBe("hi42\n");
	});

	it("renders a Lisp error instead of throwing", () => {
		const r = new ReplSession();
		expect(r.eval("(car 1)")).toContain("EvalException");
	});

	it("renders an unbalanced expression instead of hanging", () => {
		const r = new ReplSession();
		expect(r.eval("(+ 1 2")).toContain("unbalanced expression");
	});

	it("reset() clears all definitions", () => {
		const r = new ReplSession();
		r.eval("(defun sq (x) (* x x))");
		r.reset();
		expect(r.eval("sq")).toContain("void variable");
	});
});
