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
			r.eval("(halt)");
			expect(r.takeFinished()).toBe(true);
			expect(r.takeProseFeedback()).toContain('"halt" is not defined');
		});
	});
});

describe("prose with parentheses in it", () => {
	it("runs the real form and reports the aside it skipped", () => {
		const r = new AgentRepl();
		expect(r.eval("Here is the plan (see below):\n(+ 1 2)")).toBe(
			'+-1: 3\nskipped (see below) — "see" is not defined, so this was read as prose\n',
		);
	});

	it("recovers the form after an unclosed parenthesis", () => {
		const r = new AgentRepl();
		expect(r.eval("The result (roughly is fine\n(+ 1 2)")).toBe(
			'+-1: 3\nskipped unclosed "(" on line 1\n',
		);
	});

	it("errors on a misspelled call that passes a value", () => {
		const r = new AgentRepl();
		expect(r.eval('(prin "hi")')).toContain("undefined: prin");
	});

	it("names the symbol it did not recognise", () => {
		const r = new AgentRepl();
		expect(r.eval('(echo "hi") (lenght lst)')).toMatch(
			/"lenght" is not defined/,
		);
		const answered = new AgentRepl();
		answered.eval("(lenght lst)");
		expect(answered.takeProseFeedback()).toMatch(/"lenght" is not defined/);
	});

	it("reports each aside it skipped", () => {
		const r = new AgentRepl();
		expect(r.eval('(echo "x") (see one) and (see two)').split("\n")).toEqual([
			"x",
			'skipped (see one) — "see" is not defined, so this was read as prose',
			'skipped (see two) — "see" is not defined, so this was read as prose',
			"",
		]);
	});

	it("reports a repeated aside once", () => {
		const r = new AgentRepl();
		const out = r.eval('(echo "x") (see one) and (see one)');
		expect(out.split("\n").filter((l) => l.startsWith("skipped"))).toHaveLength(
			1,
		);
	});

	describe("a call to a tool that is not loaded", () => {
		it("errors instead of being skipped as prose", () => {
			const r = new AgentRepl();
			expect(r.eval('(playwright/browser_navigate :url "test")')).toContain(
				"undefined: playwright/browser_navigate",
			);
		});

		it("does not end the loop, and holds nothing back", () => {
			const r = new AgentRepl();
			r.eval('(playwright/browser_navigate :url "test")');
			expect(r.takeFinished()).toBe(false);
			expect(r.takeProseFeedback()).toBe("");
		});

		it("runs once its server defines the binding", () => {
			const r = new AgentRepl();
			r.eval('(defun playwright/browser_navigate (&rest args) "ok")');
			expect(r.eval('(playwright/browser_navigate :url "test")')).toBe(
				'playwright/browser_navigate-1: "ok"\n',
			);
		});
	});

	describe("the finished signal", () => {
		it("is raised for a reply with no parenthesis at all", () => {
			const r = new AgentRepl();
			r.eval("the sum is 3");
			expect(r.takeFinished()).toBe(true);
		});

		it("is not raised for a reply truncated mid-form", () => {
			const r = new AgentRepl();
			r.eval('(princ "hi"');
			expect(r.takeFinished()).toBe(false);
		});

		it("is raised for a reply that is only a prose aside", () => {
			const r = new AgentRepl();
			expect(r.eval("all done (see above)")).toBe("");
			expect(r.takeFinished()).toBe(true);
		});

		it("is raised for an answer whose aside could not be parsed", () => {
			const r = new AgentRepl();
			expect(r.eval("And others (including a deprecated `read_file`).")).toBe(
				"",
			);
			expect(r.takeFinished()).toBe(true);
			expect(r.takeProseFeedback()).toContain('unexpected ")" on line 1');
		});

		it("is not raised when a form ran alongside the aside", () => {
			const r = new AgentRepl();
			r.eval("almost (see above): (+ 1 2)");
			expect(r.takeFinished()).toBe(false);
		});
	});

	describe("withheld prose feedback", () => {
		it("keeps the notes an answer did not return", () => {
			const r = new AgentRepl();
			expect(r.eval("all done (see above)")).toBe("");
			expect(r.takeProseFeedback()).toBe(
				'skipped (see above) — "see" is not defined, so this was read as prose\n',
			);
		});

		it("clears them once read", () => {
			const r = new AgentRepl();
			r.eval("all done (see above)");
			r.takeProseFeedback();
			expect(r.takeProseFeedback()).toBe("");
		});

		it("accumulates the notes of several answers", () => {
			const r = new AgentRepl();
			r.eval("all done (see above)");
			r.eval("truly done (see below)");
			expect(r.takeProseFeedback().split("\n").filter(Boolean).length).toBe(2);
		});

		it("holds nothing back from a step that ran code", () => {
			const r = new AgentRepl();
			expect(r.eval("(+ 1 2) (see above)")).toContain("skipped (see above)");
			expect(r.takeProseFeedback()).toBe("");
		});

		it("holds nothing back from prose with no parenthesis in it", () => {
			const r = new AgentRepl();
			r.eval("the sum is 3");
			expect(r.takeProseFeedback()).toBe("");
		});

		it("returns the note for a reply truncated mid-form", () => {
			const r = new AgentRepl();
			expect(r.eval('(princ "hi"')).toContain('unclosed "("');
			expect(r.takeProseFeedback()).toBe("");
		});

		it("reset() drops what was held", () => {
			const r = new AgentRepl();
			r.eval("all done (see above)");
			r.reset();
			expect(r.takeProseFeedback()).toBe("");
		});
	});
});
