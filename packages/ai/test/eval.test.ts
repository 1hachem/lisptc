import { describe, expect, test } from "vitest";
import { checkUserCode, type EvalMessage, evalUserCode } from "../src/eval.ts";
import { extension, testRepls } from "./helpers.ts";

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

describe("checking user code", () => {
	const checked = testRepls([
		extension((hooks) =>
			hooks.admit.use(async (interp, code, next) =>
				code.includes("bad")
					? { code, rejected: "line 1: bad call" }
					: next(interp, code),
			),
		),
	]);

	test("passes code nothing rejects", async () => {
		const threadId = crypto.randomUUID();
		expect(await checkUserCode("(+ 1 2)", { repls: checked, threadId })).toBe(
			undefined,
		);
	});

	test("turns a rejection into an event asking the agent to fix it", async () => {
		const threadId = crypto.randomUUID();
		const event = await checkUserCode("(bad)", { repls: checked, threadId });
		expect(event?.source).toBe("lisp-check");
		expect(event?.text).toContain("the user ran this code");
		expect(event?.text).toContain("(bad)");
		expect(event?.text).toContain("line 1: bad call");
	});
});
