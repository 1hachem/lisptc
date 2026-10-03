import { settled } from "@repo/interpreter/drive";
import {
	annotating,
	type ModelDelta,
	type ModelRequest,
	slot,
	type TurnOutcome,
} from "@repo/interpreter/session";
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
					hooks.beginStep.use(function* (ctx, next) {
						ctx.emit("something worth knowing");
						yield* next(ctx);
					});
				}),
			],
		});

		expect((await r.beginStep()).emitted).toBe("something worth knowing");
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

	it("spans the forms a step did not run", async () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) => {
					hooks.unrun.use((interp, code, next) => [
						...next(interp, code),
						{ span: [0, code.trimEnd().length], reason: "left alone" },
					]);
				}),
			],
		});

		expect(r.unrun("(echo 1)")).toEqual([
			{ span: [0, 8], reason: "left alone" },
		]);
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

describe("an extension hooking the turn", () => {
	const request: ModelRequest = {
		system: "be brief",
		messages: [{ role: "user", content: "hi" }],
	};

	async function* canned(text: string): AsyncIterable<ModelDelta> {
		yield { text };
	}

	async function collect(stream: AsyncIterable<ModelDelta>): Promise<string> {
		let text = "";
		for await (const delta of stream) text += delta.text ?? "";
		return text;
	}

	it("starts a turn with nothing to say when nobody hooks it", async () => {
		const r = new AgentRepl({ extensions: [] });

		expect(await r.turnStart()).toBe("");
	});

	it("speaks once at the start of the turn", async () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) => {
					hooks.turnStart.use(function* (ctx, next) {
						ctx.emit("a fresh turn");
						yield* next(ctx);
					});
				}),
			],
		});

		expect(await r.turnStart()).toBe("a fresh turn");
	});

	it("hands the system prompt back unchanged when nobody hooks it", async () => {
		const r = new AgentRepl({ extensions: [] });

		expect(await r.system("you are a repl")).toBe("you are a repl");
	});

	it("adds to the system prompt, and may wait to do it", async () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) => {
					hooks.system.use(function* (interp, prompt, next) {
						const role = yield* settled(Promise.resolve("you are a pirate"));
						return yield* next(interp, `${prompt}\n\n${role}`);
					});
				}),
			],
		});

		expect(await r.system("you are a repl")).toBe(
			"you are a repl\n\nyou are a pirate",
		);
	});

	it("rewrites what the model sees", () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) => {
					hooks.context.use((interp, messages, next) =>
						next(interp, [...messages, { role: "user", content: "and more" }]),
					);
				}),
			],
		});

		expect(r.context(request.messages).map((m) => m.content)).toEqual([
			"hi",
			"and more",
		]);
		expect(new AgentRepl({ extensions: [] }).context(request.messages)).toBe(
			request.messages,
		);
	});

	it("calls the model it is handed when nobody hooks the call", async () => {
		const r = new AgentRepl({ extensions: [] });

		expect(await collect(r.modelCall(request, () => canned("(+ 1 2)")))).toBe(
			"(+ 1 2)",
		);
	});

	it("answers in place of the model", async () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) => hooks.modelCall.use(() => canned("replayed"))),
			],
		});

		expect(await collect(r.modelCall(request, () => canned("live")))).toBe(
			"replayed",
		);
	});

	it("reads the response the way it is told, then lets a hook rewrite it", () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) =>
					hooks.response.use((interp, text, next) =>
						next(interp, text.toUpperCase()),
					),
				),
			],
		});

		expect(r.response(" (car x) ", (t) => t.trim())).toBe("(CAR X)");
	});

	it("keeps the loop's verdict on a step unless a hook overrides it", () => {
		const plain = new AgentRepl({ extensions: [] });
		const stubborn = new AgentRepl({
			extensions: [extension((hooks) => hooks.stepEnd.use(() => "continue"))],
		});

		expect(plain.stepEnd(1, "halt")).toBe("halt");
		expect(stubborn.stepEnd(1, "halt")).toBe("continue");
	});

	it("settles as the loop asked when nobody hooks it", async () => {
		const r = new AgentRepl({ extensions: [] });

		expect(await r.beforeSettle(false)).toEqual({ more: false, emitted: "" });
		expect(await r.beforeSettle(true)).toEqual({ more: true, emitted: "" });
	});

	it("asks for one more step, and says why", async () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) => {
					hooks.beforeSettle.use(function* (ctx, more, next) {
						ctx.emit("check your answer");
						yield* next(ctx, more);
						return true;
					});
				}),
			],
		});

		expect(await r.beforeSettle(false)).toEqual({
			more: true,
			emitted: "check your answer",
		});
	});

	it("sees how the turn ended", () => {
		const outcomes: [TurnOutcome, number][] = [];
		const r = new AgentRepl({
			extensions: [
				extension((hooks) =>
					hooks.settled.use((interp, outcome, steps, next) => {
						outcomes.push([outcome, steps]);
						next(interp, outcome, steps);
					}),
				),
			],
		});

		r.settled("halt", 3);

		expect(outcomes).toEqual([["halt", 3]]);
	});
});
