import { ends } from "@repo/interpreter/effects";
import type { EvalOutput } from "@repo/repl/repl";
import { describe, expect, it } from "vitest";
import { agentRepl } from "./helpers.ts";

function proseNote(out: EvalOutput): string {
	return out.notes
		.filter((said) => said.source === "prose")
		.map((said) => said.content)
		.join("\n");
}

function replied(r: ReturnType<typeof agentRepl>, code: string) {
	return r.evalOutput(code);
}

async function ended(code: string): Promise<boolean> {
	return ends((await replied(agentRepl(), code)).effects);
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
			const out = await replied(agentRepl(), "the answer is 42");
			expect(out.model).toBe("");
			expect(ends(out.effects)).toBe(true);
		});

		it("is raised on an empty program", async () => {
			expect(await ended("   \n  ")).toBe(true);
		});

		it("is not raised when prose merely surrounds a form", async () => {
			const out = await replied(
				agentRepl(),
				"first square it: (* 3 3) and there it is",
			);
			expect(out.model).toBe("*-1: 9\n");
			expect(ends(out.effects)).toBe(false);
		});

		it("is not raised for a form that only errors", async () => {
			expect(await ended("(car 1)")).toBe(false);
		});

		it("has no halt built-in — prose replaced it", async () => {
			const out = await replied(agentRepl(), "(halt)");
			expect(ends(out.effects)).toBe(true);
			expect(proseNote(out)).toContain('"halt" is not defined');
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
		const answered = await replied(agentRepl(), "(lenght lst)");
		expect(proseNote(answered)).toMatch(/"lenght" is not defined/);
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
			const out = await replied(
				agentRepl(),
				'(playwright/browser_navigate :url "test")',
			);
			expect(ends(out.effects)).toBe(false);
			expect(proseNote(out)).toBe("");
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
		it("is not raised for code the user ran rather than the model", async () => {
			const out = await agentRepl().evalMessage("all done (see above)");
			expect(ends(out.effects)).toBe(false);
			expect(proseNote(out)).toBe("");
		});

		it("is raised for a reply with no parenthesis at all", async () => {
			expect(await ended("the sum is 3")).toBe(true);
		});

		it("is not raised for a reply truncated mid-form", async () => {
			expect(await ended('(princ "hi"')).toBe(false);
		});

		it("is raised for a reply that is only a prose aside", async () => {
			const out = await replied(agentRepl(), "all done (see above)");
			expect(out.model).toBe("");
			expect(ends(out.effects)).toBe(true);
		});

		it("is raised for an answer whose aside could not be parsed", async () => {
			const out = await replied(
				agentRepl(),
				"And others (including a deprecated `read_file`).",
			);
			expect(out.model).toBe("");
			expect(ends(out.effects)).toBe(true);
			expect(proseNote(out)).toContain('unexpected ")" on line 1');
		});

		it("is not raised when a form ran alongside the aside", async () => {
			expect(await ended("almost (see above): (+ 1 2)")).toBe(false);
		});
	});

	describe("the note on prose that ran nothing", () => {
		it("keeps the notes an answer did not return", async () => {
			const out = await replied(agentRepl(), "all done (see above)");
			expect(out.model).toBe("");
			expect(proseNote(out)).toContain(
				'skipped (see above) — "see" is not defined, so this was read as prose',
			);
		});

		it("holds nothing back from prose with no parenthesis in it", async () => {
			expect(proseNote(await replied(agentRepl(), "the sum is 3"))).toBe("");
		});

		it("returns the note for a reply truncated mid-form", async () => {
			const out = await replied(agentRepl(), '(princ "hi"');
			expect(out.model).toContain('unclosed "("');
			expect(proseNote(out)).toBe("");
		});
	});
});
