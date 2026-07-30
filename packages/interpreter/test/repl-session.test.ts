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

	describe("halt", () => {
		it("(halt) returns t and raises the halted flag", () => {
			const r = new ReplSession();
			expect(r.eval("(halt)")).toBe("t\n");
			expect(r.takeHalted()).toBe(true);
		});

		it("(halt value) returns the value", () => {
			const r = new ReplSession();
			expect(r.eval("(halt 42)")).toBe("42\n");
			expect(r.takeHalted()).toBe(true);
		});

		it("takeHalted() clears the flag after reading", () => {
			const r = new ReplSession();
			r.eval("(halt)");
			expect(r.takeHalted()).toBe(true);
			expect(r.takeHalted()).toBe(false);
		});

		it("is false when no (halt) was evaluated", () => {
			const r = new ReplSession();
			r.eval("(+ 1 2)");
			expect(r.takeHalted()).toBe(false);
		});

		it("only sets the flag when the (halt) branch actually runs", () => {
			const r = new ReplSession();
			r.eval("(if nil (halt) 1)");
			expect(r.takeHalted()).toBe(false);
		});

		it("reset() clears a raised halted flag", () => {
			const r = new ReplSession();
			r.eval("(halt)");
			r.reset();
			expect(r.takeHalted()).toBe(false);
		});
	});
});
