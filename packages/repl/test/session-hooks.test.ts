import { annotating, slot } from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { AgentRepl, MemoryRepl } from "../src/repl.ts";
import { extension } from "./helpers.ts";

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

	it("adds to what the model is shown, beside what the human read", async () => {
		const r = new MemoryRepl({
			extensions: [
				extension((hooks) => {
					hooks.stepOutput.use((ctx, out, next) =>
						next(ctx, { ...out, model: `${out.model}and one more thing\n` }),
					);
				}),
			],
		});

		const { model, user } = await r.evalOutput('(echo "hi")');
		expect(model).toBe("and one more thing\n");
		expect(user).toBe("hi\n");
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

	it("speaks before the model does, and its words ride the turn", async () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) => {
					hooks.beginTurn.use(function* (ctx, next) {
						ctx.say("something worth knowing");
						yield* next(ctx);
					});
				}),
			],
		});

		expect((await r.beginTurn()).said).toBe("something worth knowing");
	});

	it("annotates the step on a lane of its own, beside the output", async () => {
		const r = new MemoryRepl({
			extensions: [
				extension((hooks) => {
					hooks.annotate.use((buffer, into, next) =>
						next(buffer, annotating(into, "step", { envelopes: 1 })),
					);
				}),
			],
		});

		const { user, annotations } = await r.evalOutput('(echo "hi")');

		expect(user).toBe("hi\n");
		expect(annotations.step).toEqual({ envelopes: 1 });
		expect(annotations.output).toEqual({});
	});

	it("annotates a ui action the same way it annotates a step", async () => {
		const r = new MemoryRepl({
			extensions: [
				extension((hooks) => {
					hooks.invoke.use(async () => {});
					hooks.annotate.use((buffer, into, next) =>
						next(buffer, annotating(into, "output", { view: "a1" })),
					);
				}),
			],
		});

		expect((await r.invokeUi("a1")).annotations.output).toEqual({
			view: "a1",
		});
	});

	it("reports nothing on a lane no extension claimed", async () => {
		const r = new MemoryRepl({ extensions: [] });

		expect((await r.evalOutput("(+ 1 1)")).annotations).toEqual({
			step: {},
			output: {},
		});
	});

	it("names the forms a step did not run", async () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) => {
					hooks.unrun.use((interp, code, next) => [
						...next(interp, code),
						code.trim(),
					]);
				}),
			],
		});

		expect(r.unrun("(echo 1)")).toEqual(["(echo 1)"]);
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
