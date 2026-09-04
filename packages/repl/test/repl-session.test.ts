import { describe, expect, it } from "vitest";
import { AgentRepl } from "../src/repl.ts";

describe("AgentRepl (in-process REPL binding)", () => {
	it("returns the value of the last form", () => {
		const r = new AgentRepl();
		expect(r.eval("(+ 1 2)")).toBe("+-1: 3\n");
	});

	it("persists definitions across eval calls", () => {
		const r = new AgentRepl();
		r.eval("(defun sq (x) (* x x))");
		expect(r.eval("(sq 5)")).toBe("sq-1: 25\n");
	});

	it("puts echoed output before the result report", () => {
		const r = new AgentRepl();
		expect(r.eval('(progn (echo "hi") 42)')).toBe("hi\nprogn-1: 42\n");
	});

	// `echo` is the only thing that prints, and a step ending in one is
	// reported by what it printed rather than by a line about the echo itself.
	it("reports nothing on top of what a step echoed", () => {
		const r = new AgentRepl();
		expect(r.eval('(echo "hi")')).toBe("hi\n");
		expect(r.eval("(echo)")).toBe("\n");
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

	describe("the finished signal", () => {
		it("raises the flag on prose with no form in it, and prints nothing", () => {
			const r = new AgentRepl();
			expect(r.eval("the answer is 42")).toBe("");
			expect(r.takeFinished()).toBe(true);
		});

		it("raises it on an empty program", () => {
			const r = new AgentRepl();
			r.eval("   \n  ");
			expect(r.takeFinished()).toBe(true);
		});

		it("takeFinished() clears the flag after reading", () => {
			const r = new AgentRepl();
			r.eval("done");
			expect(r.takeFinished()).toBe(true);
			expect(r.takeFinished()).toBe(false);
		});

		it("is false when the program held a form", () => {
			const r = new AgentRepl();
			r.eval("(+ 1 2)");
			expect(r.takeFinished()).toBe(false);
		});

		it("is false when prose merely surrounds a form", () => {
			const r = new AgentRepl();
			expect(r.eval("first square it: (* 3 3) and there it is")).toBe(
				"*-1: 9\n",
			);
			expect(r.takeFinished()).toBe(false);
		});

		it("stays down for a form that only errors", () => {
			const r = new AgentRepl();
			r.eval("(car 1)");
			expect(r.takeFinished()).toBe(false);
		});

		it("reset() clears a raised flag", () => {
			const r = new AgentRepl();
			r.eval("all done");
			r.reset();
			expect(r.takeFinished()).toBe(false);
		});

		it("has no halt built-in — prose replaced it", () => {
			const r = new AgentRepl();
			expect(r.eval("(halt)")).toContain("undefined: halt");
		});
	});
});
