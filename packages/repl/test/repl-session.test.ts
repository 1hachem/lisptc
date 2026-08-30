import { describe, expect, it } from "vitest";
import { AgentRepl } from "../src/repl.ts";

describe("AgentRepl (in-process REPL binding)", () => {
	it("returns the value of the last form", () => {
		const r = new AgentRepl();
		expect(r.eval("(+ 1 2)")).toBe("3\n");
	});

	it("persists definitions across eval calls", () => {
		const r = new AgentRepl();
		r.eval("(defun sq (x) (* x x))");
		expect(r.eval("(sq 5)")).toBe("25\n");
	});

	it("captures side-effect output before the value", () => {
		const r = new AgentRepl();
		expect(r.eval('(progn (princ "hi") 42)')).toBe("hi42\n");
	});

	it("does not echo a printed value a second time", () => {
		const r = new AgentRepl();
		expect(r.eval('(print "hi")')).toBe('"hi"\n');
		expect(r.eval('(princ "hi")')).toBe("hi");
		expect(r.eval("(terpri)")).toBe("\n");
	});

	it("still echoes nil — only the printing sentinel is suppressed", () => {
		const r = new AgentRepl();
		expect(r.eval("(= 1 2)")).toBe("nil\n");
	});

	it("renders a Lisp error instead of throwing", () => {
		const r = new AgentRepl();
		expect(r.eval("(car 1)")).toContain("EvalException");
	});

	it("renders an unbalanced expression instead of hanging", () => {
		const r = new AgentRepl();
		expect(r.eval("(+ 1 2")).toContain("unbalanced expression");
	});

	it("reset() clears all definitions", () => {
		const r = new AgentRepl();
		r.eval("(defun sq (x) (* x x))");
		r.reset();
		expect(r.eval("(progn sq)")).toContain("void variable");
	});

	describe("halt", () => {
		it("(halt) returns t and raises the halted flag", () => {
			const r = new AgentRepl();
			expect(r.eval("(halt)")).toBe("t\n");
			expect(r.takeHalted()).toBe(true);
		});

		it("(halt value) returns the value", () => {
			const r = new AgentRepl();
			expect(r.eval("(halt 42)")).toBe("42\n");
			expect(r.takeHalted()).toBe(true);
		});

		it("takeHalted() clears the flag after reading", () => {
			const r = new AgentRepl();
			r.eval("(halt)");
			expect(r.takeHalted()).toBe(true);
			expect(r.takeHalted()).toBe(false);
		});

		it("is false when no (halt) was evaluated", () => {
			const r = new AgentRepl();
			r.eval("(+ 1 2)");
			expect(r.takeHalted()).toBe(false);
		});

		it("only sets the flag when the (halt) branch actually runs", () => {
			const r = new AgentRepl();
			r.eval("(if nil (halt) 1)");
			expect(r.takeHalted()).toBe(false);
		});

		it("reset() clears a raised halted flag", () => {
			const r = new AgentRepl();
			r.eval("(halt)");
			r.reset();
			expect(r.takeHalted()).toBe(false);
		});
	});
});
