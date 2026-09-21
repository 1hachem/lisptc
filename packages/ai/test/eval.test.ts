import { describe, expect, test } from "vitest";
import { type EvalMessage, evalUserCode } from "../src/eval.ts";
import { testRepls } from "./helpers.ts";

const repls = testRepls();

function result(message: EvalMessage): { output: string; error: boolean } {
	return JSON.parse(message.content) as { output: string; error: boolean };
}

function display(message: EvalMessage): string {
	return (message.additional_kwargs?.display as string) ?? "";
}

describe("user code", () => {
	test("runs in the thread's own repl", async () => {
		const threadId = crypto.randomUUID();
		await evalUserCode("(setq x 41)", { repls, threadId });
		const message = await evalUserCode("(echo (+ x 1))", { repls, threadId });
		expect(display(message)).toContain("42");
	});

	test("cannot reach another thread's definitions", async () => {
		await evalUserCode("(setq y 1)", {
			repls,
			threadId: crypto.randomUUID(),
		});
		const message = await evalUserCode("(echo y)", {
			repls,
			threadId: crypto.randomUUID(),
		});
		expect(result(message).output).toContain("void variable: y");
	});

	test("leaves the agent loop's halt signal untouched", async () => {
		const threadId = crypto.randomUUID();
		await evalUserCode("(just prose, nothing to run)", { repls, threadId });
		const repl = repls.peek(threadId);
		expect(repl?.takeFinished()).toBe(false);
		expect(repl?.takeProseFeedback()).toBe("");
	});
});
