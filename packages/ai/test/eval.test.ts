import { describe, expect, test } from "vitest";
import { type EvalMessage, evalUserCode } from "../src/eval.ts";
import { getThreadRepl } from "../src/repl-store.ts";

function result(message: EvalMessage): { output: string; error: boolean } {
	return JSON.parse(message.content) as { output: string; error: boolean };
}

describe("user code", () => {
	test("runs in the thread's own repl", async () => {
		const thread = crypto.randomUUID();
		await evalUserCode("(setq x 41)", thread);
		const message = await evalUserCode("(+ x 1)", thread);
		expect(result(message).output).toContain("42");
	});

	test("cannot reach another thread's definitions", async () => {
		await evalUserCode("(setq y 1)", crypto.randomUUID());
		const message = await evalUserCode("(echo y)", crypto.randomUUID());
		expect(result(message).output).toContain("void variable: y");
	});

	test("leaves the agent loop's halt signal untouched", async () => {
		const thread = crypto.randomUUID();
		await evalUserCode("(just prose, nothing to run)", thread);
		const repl = getThreadRepl(thread);
		expect(repl.takeFinished()).toBe(false);
		expect(repl.takeProseFeedback()).toBe("");
	});
});
