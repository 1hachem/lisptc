import { compactionExtension } from "@repo/interpreter/compaction";
import type { Interp, InterpExtension } from "@repo/interpreter/lisp";
import type { SessionHooks } from "@repo/interpreter/session";
import { slot } from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { AgentRepl, MemoryRepl } from "../src/repl.ts";

function extension(session: (hooks: SessionHooks) => void): InterpExtension {
	return Object.assign((_interp: Interp): void => {}, { session });
}

describe("an extension hooking the session", () => {
	it("wraps the evaluation and sees the code", async () => {
		const seen: string[] = [];
		const r = new MemoryRepl({
			extensions: [
				extension((hooks) => {
					hooks.evalStep.use(async (ctx, next) => {
						seen.push(`before ${ctx.code}`);
						await next(ctx);
						seen.push("after");
					});
				}),
			],
		});

		await r.eval("(+ 1 1)");

		expect(seen).toEqual(["before (+ 1 1)", "after"]);
	});

	it("adds to what the model is shown", async () => {
		const r = new MemoryRepl({
			extensions: [
				compactionExtension(),
				extension((hooks) => {
					hooks.stepOutput.use((ctx, out, next) =>
						next(ctx, { ...out, model: `${out.model}and one more thing\n` }),
					);
				}),
			],
		});

		expect(await r.eval('(echo "hi")')).toBe("hi\nand one more thing\n");
	});

	it("rewrites how an error reads", async () => {
		const r = new MemoryRepl({
			extensions: [
				extension((hooks) => {
					hooks.stepError.use(() => ({ model: "nope\n", user: "" }));
				}),
			],
		});

		expect(await r.eval("(nope)")).toBe("nope\n");
	});

	it("decides that a step ended the turn", async () => {
		const r = new AgentRepl({
			extensions: [extension((hooks) => hooks.answered.use(() => true))],
		});

		await r.evalOutput('(echo "hi")');

		expect(r.takeFinished()).toBe(true);
	});

	it("speaks before the model does, and its words ride the turn", () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) => {
					hooks.beginTurn.use((ctx, next) => {
						ctx.say("something worth knowing");
						next(ctx);
					});
				}),
			],
		});

		expect(r.beginTurn().said).toBe("something worth knowing");
	});

	it("hands a value to whoever holds the slot", () => {
		const counter = slot<{ n: number }>("counter");
		const held = { n: 7 };
		const r = new MemoryRepl({
			extensions: [extension((hooks) => hooks.fill(counter, held))],
		});

		expect(r.hooks.filled(counter)).toBe(held);
	});

	it("leaves a slot nobody filled empty", () => {
		const counter = slot<{ n: number }>("counter");
		const r = new MemoryRepl({ extensions: [] });

		expect(r.hooks.filled(counter)).toBeUndefined();
	});
});
