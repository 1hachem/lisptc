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

		// `(halt)` names nothing, so it is prose — which ends the loop just as
		// prose does, though the note says the name was not recognised.
		it("has no halt built-in — prose replaced it", () => {
			const r = new AgentRepl();
			r.eval("(halt)");
			expect(r.takeFinished()).toBe(true);
			expect(r.takeProseFeedback()).toContain('"halt" is not defined');
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
			'+-1: 3\nskipped (see below) — "see" is not defined, so this was read as prose\n',
		);
	});

	it("recovers the form after an unclosed parenthesis", () => {
		const r = new AgentRepl();
		expect(r.eval("The result (roughly is fine\n(+ 1 2)")).toBe(
			'+-1: 3\nskipped unclosed "(" on line 1\n',
		);
	});

	// A misspelling with a literal in it is a call, not a turn of phrase, so it
	// errors where the agent sees it immediately.
	it("errors on a misspelled call that passes a value", () => {
		const r = new AgentRepl();
		expect(r.eval('(prin "hi")')).toContain("undefined: prin");
	});

	// A misspelling with nothing but words in it cannot be told from prose, so
	// the skip note is the only sign the name was wrong — it has to name it,
	// wherever it is delivered. A reply that is nothing BUT the misspelled call
	// ran nothing, so its note waits for the next user message (see "withheld
	// prose feedback"); a reply that also ran something gets it straight back.
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

	/*
	 * A call to an MCP tool whose server is not loaded is the case tolerance
	 * must NOT swallow: skipping it would end the agent's turn on an answer it
	 * never computed, and the note would not reach it until the user wrote
	 * again. It is an error, so the loop goes on and the agent can load the
	 * server and retry in the same task.
	 */
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

		// A reply whose every parenthesis was prose ran nothing, so there is
		// nothing to feed back: it is the answer, however many asides it holds.
		it("is raised for a reply that is only a prose aside", () => {
			const r = new AgentRepl();
			expect(r.eval("all done (see above)")).toBe("");
			expect(r.takeFinished()).toBe(true);
		});

		it("is not raised when a form ran alongside the aside", () => {
			const r = new AgentRepl();
			r.eval("almost (see above): (+ 1 2)");
			expect(r.takeFinished()).toBe(false);
		});
	});

	/*
	 * The notes for an answer's asides are not returned to the host — feeding
	 * them back would win the user an extra agent turn saying what the answer
	 * already said. They are kept for the next user message instead, so the
	 * model still learns not to write the aside again.
	 */
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

		// A truncated reply is a step to resume, not an answer, so its note goes
		// straight back to the model.
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
