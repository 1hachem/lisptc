import { effect, ends } from "@repo/interpreter/effects";
import { print } from "@repo/interpreter/journal";
import { describe, expect, it } from "vitest";
import { AgentRepl, MemoryRepl } from "../src/repl.ts";
import { extension } from "./helpers.ts";

describe("an extension hooking the session", () => {
	it("wraps the evaluation and sees the code", async () => {
		const r = new MemoryRepl({
			extensions: [
				extension((hooks) => {
					hooks.evalStep.use(async (ctx, next) => {
						print(ctx.interp.journal, { user: `before ${ctx.code}\n` });
						await next(ctx);
						print(ctx.interp.journal, { user: "after\n" });
					});
				}),
			],
		});

		expect((await r.evalOutput('(echo "hi")')).user).toBe(
			'before (echo "hi")\nhi\nafter\n',
		);
	});

	it("tells a step who wrote its code, the assistant or the user", async () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) => {
					hooks.evalStep.use((ctx, next) => {
						print(ctx.interp.journal, { user: `${ctx.author}\n` });
						return next(ctx);
					});
				}),
			],
		});

		expect((await r.evalOutput("(+ 1 1)")).user).toBe("assistant\n");
		expect((await r.evalMessage("(+ 1 1)")).user).toBe("user\n");
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

	it("lets a step end the turn", async () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) =>
					hooks.evalStep.use(async (ctx, next) => {
						await next(ctx);
						ctx.interp.journal.write(effect, { type: "end" });
					}),
				),
			],
		});

		const out = await r.evalOutput('(echo "hi")');

		expect(ends(out.effects)).toBe(true);
	});

	it("speaks before the model does, as a note in the conversation", async () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) => {
					hooks.beginStep.use(function* (ctx, next) {
						ctx.interp.conversation.append("test", "something worth knowing");
						yield* next(ctx);
					});
				}),
			],
		});

		expect((await r.beginStep()).notes).toEqual([
			{ role: "system", content: "something worth knowing", source: "test" },
		]);
	});

	it("journals nothing when no extension records", async () => {
		const r = new MemoryRepl({ extensions: [] });

		expect((await r.evalOutput("(+ 1 1)")).entries).toEqual([]);
	});
});

describe("an extension hooking the turn", () => {
	it("starts a turn with nothing to say when nobody hooks it", async () => {
		const r = new AgentRepl({ extensions: [] });

		expect((await r.turnStart()).notes).toEqual([]);
	});

	it("speaks once at the start of the turn", async () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) => {
					hooks.turnStart.use(function* (ctx, next) {
						ctx.interp.conversation.append("test", "a fresh turn");
						yield* next(ctx);
					});
				}),
			],
		});

		expect((await r.turnStart()).notes.map((n) => n.content)).toEqual([
			"a fresh turn",
		]);
	});

	it("hands the final answer over as written unless a hook adds to it", () => {
		const plain = new AgentRepl({ extensions: [] });
		const signed = new AgentRepl({
			extensions: [
				extension((hooks) =>
					hooks.answer.use((interp, code, next) =>
						next(interp, `${code}\n-- signed`),
					),
				),
			],
		});

		expect(plain.answer("done")).toBe("done");
		expect(signed.answer("done")).toBe("done\n-- signed");
	});

	it("asks for one more step, and says why", async () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) => {
					hooks.beforeSettle.use(function* (ctx, more, next) {
						ctx.interp.conversation.append("test", "check your answer");
						yield* next(ctx, more);
						return true;
					});
				}),
			],
		});

		expect(await r.beforeSettle(false)).toMatchObject({
			more: true,
			notes: [{ role: "system", content: "check your answer", source: "test" }],
		});
	});
});
