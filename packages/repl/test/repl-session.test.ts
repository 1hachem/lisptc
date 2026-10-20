import { ends } from "@repo/interpreter/effects";
import { type LlmCall, llmSlot } from "@repo/interpreter/observe";
import { describe, expect, it } from "vitest";
import { agentRepl, answering, noting, observedExtension } from "./helpers.ts";

describe("AgentRepl (in-process REPL binding)", () => {
	it("hands the human what a step echoed", async () => {
		const r = agentRepl();
		expect((await r.evalOutput('(echo "hi")')).user).toBe("hi\n");
		expect((await r.evalOutput("(echo)")).user).toBe("\n");
	});

	it("persists definitions across eval calls", async () => {
		const r = agentRepl();
		await r.eval("(defun sq (x) (* x x))");
		expect((await r.evalOutput("(echo (sq 5))")).user).toBe("25\n");
	});

	it("renders a Lisp error instead of throwing", async () => {
		const r = agentRepl();
		expect(await r.eval("(car 1)")).toContain("EvalException");
	});

	it("reports an unbalanced expression instead of hanging", async () => {
		const r = agentRepl();
		expect(await r.eval("(+ 1 2")).toContain("unexpected end of input");
	});

	it("reset() clears all definitions", async () => {
		const r = agentRepl();
		await r.eval("(defun sq (x) (* x x))");
		r.reset();
		expect(await r.eval("(progn sq)")).toContain("void variable");
	});

	describe("the end effect", () => {
		it("ends a step an extension answered, and prints nothing", async () => {
			const r = agentRepl([answering(), noting("an aside")]);
			const out = await r.evalOutput("   \n  ");
			expect(out.model).toBe("");
			expect(ends(out.effects)).toBe(true);
		});

		it("belongs to the step that raised it, not the next one", async () => {
			const r = agentRepl([answering(), noting("an aside")]);
			expect(ends((await r.evalOutput("   ")).effects)).toBe(true);
			expect(ends((await r.evalOutput("(+ 1 2)")).effects)).toBe(false);
		});

		it("is not raised when the step ran a form", async () => {
			const r = agentRepl([answering(), noting("an aside")]);
			expect(ends((await r.evalOutput("(+ 1 2)")).effects)).toBe(false);
		});

		it("is not raised when no extension claims the step", async () => {
			const r = agentRepl();
			expect(ends((await r.evalOutput("   ")).effects)).toBe(false);
		});
	});

	describe("withheld prose feedback", () => {
		it("keeps the notes an answer did not return", async () => {
			const r = agentRepl([answering(), noting("an aside")]);
			expect(await r.eval("   ")).toBe("");
			expect(r.takeProseFeedback()).toBe("skipped an aside\n");
		});

		it("clears them once read", async () => {
			const r = agentRepl([answering(), noting("an aside")]);
			await r.eval("   ");
			r.takeProseFeedback();
			expect(r.takeProseFeedback()).toBe("");
		});

		it("accumulates the notes of several answers", async () => {
			const r = agentRepl([answering(), noting("an aside")]);
			await r.eval("   ");
			await r.eval("   ");
			expect(r.takeProseFeedback().split("\n").filter(Boolean).length).toBe(2);
		});

		it("holds nothing back from a step that ran code", async () => {
			const r = agentRepl([answering(), noting("an aside")]);
			expect(await r.eval("(+ 1 2)")).toContain("skipped an aside");
			expect(r.takeProseFeedback()).toBe("");
		});

		it("reset() drops what was held", async () => {
			const r = agentRepl([answering(), noting("an aside")]);
			await r.eval("   ");
			r.reset();
			expect(r.takeProseFeedback()).toBe("");
		});
	});
});

describe("the llm observer", () => {
	it("keeps the observer its host installed across a reset", () => {
		const calls: LlmCall[] = [];
		const r = agentRepl([observedExtension()]);
		const observed = r.hooks.filled(llmSlot);
		if (observed) observed.observe = (call) => calls.push(call);

		r.reset();

		expect(r.hooks.filled(llmSlot)).toBe(observed);
		r.hooks.filled(llmSlot)?.observe?.({
			builtin: "llm/complete",
			messages: [],
			structured: false,
			latencyMs: 0,
		});
		expect(calls.map((call) => call.builtin)).toEqual(["llm/complete"]);
	});
});
