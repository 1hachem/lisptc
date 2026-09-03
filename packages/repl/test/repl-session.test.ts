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

	// An unclosed form is prose to this REPL rather than a syntax error (see
	// "prose with parentheses in it" below); either way it is reported, not
	// hung on, and the forms around it still run.
	it("reports an unclosed expression instead of hanging", () => {
		const r = new AgentRepl();
		expect(r.eval("(+ 1 2")).toContain('unclosed "("');
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
			expect(r.eval("first square it: (* 3 3) and there it is")).toBe("9\n");
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
			expect(r.eval("(halt)")).toContain('"halt" is not defined');
		});
	});
});

/*
 * The REPL is handed text a model wrote, so a sentence with a parenthesis in
 * it is prose that happens to look like code (see `ProseMode`). It must not
 * cost the step an error it cannot act on — nor, for an unclosed paren, every
 * form that followed.
 */
describe("prose with parentheses in it", () => {
	it("runs the real form and reports the aside it skipped", () => {
		const r = new AgentRepl();
		expect(r.eval("Here is the plan (see below):\n(+ 1 2)")).toBe(
			'3\nskipped (see below) — "see" is not defined, so this was read as prose\n',
		);
	});

	it("recovers the form after an unclosed parenthesis", () => {
		const r = new AgentRepl();
		expect(r.eval("The result (roughly is fine\n(+ 1 2)")).toBe(
			'3\nskipped unclosed "(" on line 1\n',
		);
	});

	// The skip note is the only sign a name was wrong, so it has to name it.
	it("names the symbol it did not recognise", () => {
		const r = new AgentRepl();
		expect(r.eval('(prin "hi")')).toMatch(/"prin" is not defined/);
	});

	it("reports a repeated aside once", () => {
		const r = new AgentRepl();
		expect(r.eval("(see one) and (see two)").split("\n").length).toBe(3);
	});

	describe("the finished signal", () => {
		// Pure prose still ends the loop: that is how an agent answers.
		it("is raised for a reply with no parenthesis at all", () => {
			const r = new AgentRepl();
			r.eval("the sum is 3");
			expect(r.takeFinished()).toBe(true);
		});

		// A reply cut off mid-form reads as prose to the tolerant reader, but
		// it is a truncated turn, not an answer — ending the loop on it would
		// strand the task.
		it("is not raised for a reply truncated mid-form", () => {
			const r = new AgentRepl();
			r.eval('(princ "hi"');
			expect(r.takeFinished()).toBe(false);
		});

		it("is not raised for a reply that is only a prose aside", () => {
			const r = new AgentRepl();
			r.eval("all done (see above)");
			expect(r.takeFinished()).toBe(false);
		});
	});
});
