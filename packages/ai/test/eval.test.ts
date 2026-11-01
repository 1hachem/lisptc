import { effect } from "@repo/interpreter/effects";
import type { Interp } from "@repo/interpreter/lisp";
import type { SessionHooks } from "@repo/interpreter/session";
import { type FormSpan, formsOnly } from "@repo/shared/lisp-forms";
import { describe, expect, test } from "vitest";
import { evalUserMessage } from "../src/eval.ts";
import type { ToolMessage } from "../src/tool-message.ts";
import { extension, testRepls } from "./helpers.ts";

const repls = testRepls();

async function evaluated(
	message: string,
	threadId: string,
	from = repls,
): Promise<ToolMessage> {
	const result = await evalUserMessage(message, { repls: from, threadId });
	if (result === undefined) throw new Error(`nothing ran for ${message}`);
	return result.message;
}

function result(message: ToolMessage): { output: string; error: boolean } {
	return JSON.parse(message.content) as { output: string; error: boolean };
}

function display(message: ToolMessage): string {
	return (message.additional_kwargs?.display as string) ?? "";
}

describe("a user message", () => {
	test("runs in the thread's own repl", async () => {
		const threadId = crypto.randomUUID();
		await evaluated("(setq x 41)", threadId);
		const message = await evaluated("(echo (+ x 1))", threadId);
		expect(display(message)).toContain("42");
	});

	test("carries the value each form returned", async () => {
		const message = await evaluated("(+ 40 2) (list 1 2)", crypto.randomUUID());
		expect(message.additional_kwargs?.results).toEqual(["42", "(1 2)"]);
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

	test("runs nothing when every form in it reads as prose", async () => {
		const aside = "(see below)";
		const blanked = (code: string) =>
			code.replace(aside, " ".repeat(aside.length));
		const asides = testRepls([
			Object.assign(
				(interp: Interp) =>
					interp.hooks.readSource.use((i, text, next) =>
						next(i, blanked(text)),
					),
				{
					session: (hooks: SessionHooks) =>
						hooks.unrun.use((interp, code, next) => {
							const at = code.indexOf(aside);
							const span: FormSpan = [at, at + aside.length];
							return [
								...next(interp, code),
								...(at < 0 ? [] : [{ span, reason: "prose" }]),
							];
						}),
				},
			),
		]);
		const threadId = crypto.randomUUID();
		expect(
			await evalUserMessage(`the plan ${aside} is long`, {
				repls: asides,
				threadId,
			}),
		).toBeUndefined();
		const ran = await evalUserMessage(`${aside} (echo (+ 40 2))`, {
			repls: asides,
			threadId,
		});
		expect(ran && display(ran.message)).toContain("42");
	});

	test("runs the forms inside ordinary text and skips the text", async () => {
		const prose = testRepls([
			(interp: Interp) =>
				interp.hooks.readSource.use((i, text, next) =>
					next(i, formsOnly(text)),
				),
		]);
		const threadId = crypto.randomUUID();
		const message = "what is (+ 40 2) and also (list 1 2), thanks";
		const ran = await evalUserMessage(message, { repls: prose, threadId });
		expect(ran?.message.additional_kwargs?.results).toEqual(["42", "(1 2)"]);
		expect(ran && result(ran.message).error).toBe(false);
	});

	test("finds nothing to run in a message without forms", async () => {
		expect(
			await evalUserMessage("no parentheses here", {
				repls,
				threadId: crypto.randomUUID(),
			}),
		).toBeUndefined();
	});

	test("leaves the agent loop's prose feedback untouched", async () => {
		const threadId = crypto.randomUUID();
		await evaluated("(just prose, nothing to run)", threadId);
		expect(repls.peek(threadId)?.takeProseFeedback()).toBe("");
	});

	test("is handed to the agent unless a form asked to stay quiet", async () => {
		const quiet = testRepls([
			extension((hooks) =>
				hooks.evalStep.use((ctx, next) => {
					if (ctx.code.includes("hush"))
						effect.emit(ctx.interp.channels, { harness: { type: "quiet" } });
					return next(ctx);
				}),
			),
		]);
		const threadId = crypto.randomUUID();
		const loud = await evalUserMessage("(+ 1 2)", { repls: quiet, threadId });
		const hushed = await evalUserMessage("(list 'hush)", {
			repls: quiet,
			threadId,
		});
		expect(loud?.quiet).toBe(false);
		expect(hushed?.quiet).toBe(true);
		expect(loud?.message.additional_kwargs?.quiet).toBeUndefined();
		expect(hushed?.message.additional_kwargs?.quiet).toBe(true);
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

	test("runs code nothing rejects", async () => {
		const message = await evaluated(
			"(echo (+ 1 2))",
			crypto.randomUUID(),
			checked,
		);
		expect(display(message)).toContain("3");
	});

	test("hands back a rejection as a stopped result instead of running it", async () => {
		const message = await evaluated("(bad)", crypto.randomUUID(), checked);
		expect(JSON.parse(message.content)).toMatchObject({
			source: "lisp-check",
			error: true,
			output: "line 1: bad call",
		});
		expect(message.additional_kwargs?.failed).toBe(true);
	});

	test("runs the code admit rewrote in place of the typed code", async () => {
		const rewriting = testRepls([
			extension((hooks) =>
				hooks.admit.use(async (interp, code, next) =>
					next(interp, code.replace("(fix)", "(echo (+ 1 1))")),
				),
			),
		]);
		const message = await evaluated("(fix)", crypto.randomUUID(), rewriting);
		expect(display(message)).toContain("2");
	});
});

describe("a step the host broke on", () => {
	const broken = testRepls([
		extension((hooks) =>
			hooks.stepOutput.use((ctx, out, next) => {
				if (ctx.code.includes("boom")) throw new Error("host broke");
				return next(ctx, out);
			}),
		),
	]);

	test("restores the repl to its last checkpoint", async () => {
		const threadId = crypto.randomUUID();
		await evaluated("(setq x 41)", threadId, broken);
		const failed = await evaluated(
			"(progn (setq x 0) 'boom)",
			threadId,
			broken,
		);
		expect(result(failed)).toMatchObject({
			output:
				"REPL error: host broke (interpreter restored to its last checkpoint, changes since then lost)",
			error: true,
		});
		const message = await evaluated("(echo (+ x 1))", threadId, broken);
		expect(display(message)).toContain("42");
	});

	test("resets the repl when nothing was checkpointed", async () => {
		const failed = await evaluated("(quote boom)", crypto.randomUUID(), broken);
		expect(result(failed).output).toContain("interpreter was reset");
	});
});
