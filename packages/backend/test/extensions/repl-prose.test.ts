import { ends } from "@repo/interpreter/effects";
import { describe, expect, it } from "vitest";
import { agentRepl } from "./helpers.ts";

async function ended(code: string, r = agentRepl()): Promise<boolean> {
	return ends((await r.evalOutput(code)).effects);
}

describe("a REPL the model faces", () => {
	it("returns the value of the last form", async () => {
		const r = agentRepl();
		expect(await r.eval("(+ 1 2)")).toBe("+-1: 3\n");
	});

	it("persists definitions across eval calls", async () => {
		const r = agentRepl();
		await r.eval("(defun sq (x) (* x x))");
		expect(await r.eval("(sq 5)")).toBe("sq-1: 25\n");
	});

	it("puts echoed output before the result report", async () => {
		const r = agentRepl();
		expect(await r.eval('(progn (echo "hi") 42)')).toBe("hi\nprogn-1: 42\n");
	});

	it("reports nothing on top of what a step echoed", async () => {
		const r = agentRepl();
		expect(await r.eval('(echo "hi")')).toBe("hi\n");
		expect(await r.eval("(echo)")).toBe("\n");
	});

	it("still echoes nil — only the printing sentinel is suppressed", async () => {
		const r = agentRepl();
		expect(await r.eval("(= 1 2)")).toBe("nil\n");
	});

	it("reports an unclosed expression instead of hanging", async () => {
		const r = agentRepl();
		expect(await r.eval("(+ 1 2")).toContain('unclosed "("');
	});

	describe("the end effect", () => {
		it("is raised on prose with no form in it, which prints nothing", async () => {
			const out = await agentRepl().evalOutput("the answer is 42");
			expect(out.model).toBe("");
			expect(ends(out.effects)).toBe(true);
		});

		it("is raised on an empty program", async () => {
			expect(await ended("   \n  ")).toBe(true);
		});

		it("is not raised when prose merely surrounds a form", async () => {
			const out = await agentRepl().evalOutput(
				"first square it: (* 3 3) and there it is",
			);
			expect(out.model).toBe("*-1: 9\n");
			expect(ends(out.effects)).toBe(false);
		});

		it("is not raised for a form that only errors", async () => {
			expect(await ended("(car 1)")).toBe(false);
		});

		it("has no halt built-in — prose replaced it", async () => {
			const r = agentRepl();
			expect(await ended("(halt)", r)).toBe(true);
			expect(r.takeProseFeedback()).toContain('"halt" is not defined');
		});
	});
});

describe("prose with parentheses in it", () => {
	it("runs the real form and reports the aside it skipped", async () => {
		const r = agentRepl();
		expect(await r.eval("Here is the plan (see below):\n(+ 1 2)")).toBe(
			'+-1: 3\nskipped (see below) — "see" is not defined, so this was read as prose\n',
		);
	});

	it("recovers the form after an unclosed parenthesis", async () => {
		const r = agentRepl();
		expect(await r.eval("The result (roughly is fine\n(+ 1 2)")).toBe(
			'+-1: 3\nskipped unclosed "(" on line 1\n',
		);
	});

	it("errors on a misspelled call that passes a value", async () => {
		const r = agentRepl();
		expect(await r.eval('(prin "hi")')).toContain("undefined: prin");
	});

	it("names the symbol it did not recognise", async () => {
		const r = agentRepl();
		expect(await r.eval('(echo "hi") (lenght lst)')).toMatch(
			/"lenght" is not defined/,
		);
		const answered = agentRepl();
		await answered.eval("(lenght lst)");
		expect(answered.takeProseFeedback()).toMatch(/"lenght" is not defined/);
	});

	it("reports each aside it skipped", async () => {
		const r = agentRepl();
		expect(
			(await r.eval('(echo "x") (see one) and (see two)')).split("\n"),
		).toEqual([
			"x",
			'skipped (see one) — "see" is not defined, so this was read as prose',
			'skipped (see two) — "see" is not defined, so this was read as prose',
			"",
		]);
	});

	it("reports a repeated aside once", async () => {
		const r = agentRepl();
		const out = await r.eval('(echo "x") (see one) and (see one)');
		expect(out.split("\n").filter((l) => l.startsWith("skipped"))).toHaveLength(
			1,
		);
	});

	describe("a call to a tool that is not loaded", () => {
		it("errors instead of being skipped as prose", async () => {
			const r = agentRepl();
			expect(
				await r.eval('(playwright/browser_navigate :url "test")'),
			).toContain("undefined: playwright/browser_navigate");
		});

		it("does not end the loop, and holds nothing back", async () => {
			const r = agentRepl();
			expect(await ended('(playwright/browser_navigate :url "test")', r)).toBe(
				false,
			);
			expect(r.takeProseFeedback()).toBe("");
		});

		it("runs once its server defines the binding", async () => {
			const r = agentRepl();
			await r.eval('(defun playwright/browser_navigate (&rest args) "ok")');
			expect(await r.eval('(playwright/browser_navigate :url "test")')).toBe(
				'playwright/browser_navigate-1: "ok"\n',
			);
		});
	});

	describe("the end effect", () => {
		it("is raised for a reply with no parenthesis at all", async () => {
			expect(await ended("the sum is 3")).toBe(true);
		});

		it("is not raised for a reply truncated mid-form", async () => {
			expect(await ended('(princ "hi"')).toBe(false);
		});

		it("is raised for a reply that is only a prose aside", async () => {
			const out = await agentRepl().evalOutput("all done (see above)");
			expect(out.model).toBe("");
			expect(ends(out.effects)).toBe(true);
		});

		it("is raised for an answer whose aside could not be parsed", async () => {
			const r = agentRepl();
			const out = await r.evalOutput(
				"And others (including a deprecated `read_file`).",
			);
			expect(out.model).toBe("");
			expect(ends(out.effects)).toBe(true);
			expect(r.takeProseFeedback()).toContain('unexpected ")" on line 1');
		});

		it("is not raised when a form ran alongside the aside", async () => {
			expect(await ended("almost (see above): (+ 1 2)")).toBe(false);
		});
	});

	describe("withheld prose feedback", () => {
		it("keeps the notes an answer did not return", async () => {
			const r = agentRepl();
			expect(await r.eval("all done (see above)")).toBe("");
			expect(r.takeProseFeedback()).toBe(
				'skipped (see above) — "see" is not defined, so this was read as prose\n',
			);
		});

		it("holds nothing back from prose with no parenthesis in it", async () => {
			const r = agentRepl();
			await r.eval("the sum is 3");
			expect(r.takeProseFeedback()).toBe("");
		});

		it("returns the note for a reply truncated mid-form", async () => {
			const r = agentRepl();
			expect(await r.eval('(princ "hi"')).toContain('unclosed "("');
			expect(r.takeProseFeedback()).toBe("");
		});
	});
});
