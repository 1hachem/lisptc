import { describe, expect, test } from "vitest";
import { type EvalMessage, evalUserMessage } from "../src/eval.ts";
import { testRepls } from "./helpers.ts";

const repls = testRepls();

async function evaluated(
	message: string,
	threadId: string,
): Promise<EvalMessage> {
	const result = await evalUserMessage(message, { repls, threadId });
	if (result === undefined) throw new Error(`nothing ran for ${message}`);
	return result;
}

function result(message: EvalMessage): { output: string; error: boolean } {
	return JSON.parse(message.content) as { output: string; error: boolean };
}

function display(message: EvalMessage): string {
	return (message.additional_kwargs?.display as string) ?? "";
}

describe("a user message", () => {
	test("runs in the thread's own repl", async () => {
		const threadId = crypto.randomUUID();
		await evaluated("(setq x 41)", threadId);
		const message = await evaluated("(echo (+ x 1))", threadId);
		expect(display(message)).toContain("42");
	});

	test("cannot reach another thread's definitions", async () => {
		await evaluated("(setq y 1)", crypto.randomUUID());
		const message = await evaluated("(echo y)", crypto.randomUUID());
		expect(result(message).output).toContain("void variable: y");
	});

	test("runs nothing when it holds no form", async () => {
		const threadId = crypto.randomUUID();
		expect(
			await evalUserMessage("just a question for the agent", {
				repls,
				threadId,
			}),
		).toBeUndefined();
		expect(repls.peek(threadId)).toBeUndefined();
	});

	test("leaves the agent loop's halt signal untouched", async () => {
		const threadId = crypto.randomUUID();
		await evaluated("(just prose, nothing to run)", threadId);
		const repl = repls.peek(threadId);
		expect(repl?.takeFinished()).toBe(false);
		expect(repl?.takeProseFeedback()).toBe("");
	});
});
