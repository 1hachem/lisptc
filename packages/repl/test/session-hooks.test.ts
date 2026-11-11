import type { Channels } from "@repo/interpreter/channels";
import { effect, ends } from "@repo/interpreter/effects";
import { journal } from "@repo/interpreter/journal";
import {
	type AgentTurn,
	slot,
	type TurnOutcome,
} from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { AgentRepl, MemoryRepl } from "../src/repl.ts";
import { extension } from "./helpers.ts";

let recorded = 0;

function recording(
	channels: Channels | undefined,
	kind: string,
	value: unknown,
): void {
	recorded += 1;
	journal.emit(channels, { harness: { id: `r${recorded}`, kind, value } });
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

	it("hands over what an extension noted during a step, beside what the human read", async () => {
		const r = new MemoryRepl({
			extensions: [
				extension((hooks) => {
					hooks.evalStep.use(async (ctx, next) => {
						await next(ctx);
						ctx.interp.conversation.append("test", "and one more thing");
					});
				}),
			],
		});

		const { notes, user } = await r.evalOutput('(echo "hi")');
		expect(notes.map((n) => n.content)).toEqual(["and one more thing"]);
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

	it("lets a step end the turn", async () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) =>
					hooks.evalStep.use(async (ctx, next) => {
						await next(ctx);
						effect.emit(ctx.interp.channels, { harness: { type: "end" } });
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

	it("journals what a step records, beside the output", async () => {
		const r = new MemoryRepl({
			extensions: [
				extension((hooks) => {
					hooks.evalStep.use(async (ctx, next) => {
						recording(ctx.interp.channels, "before", 1);
						await next(ctx);
						recording(ctx.interp.channels, "after", 2);
					});
				}),
			],
		});

		const { user, entries } = await r.evalOutput('(echo "hi")');

		expect(user).toBe("hi\n");
		expect(entries).toEqual([
			expect.objectContaining({ kind: "before", value: 1 }),
			expect.objectContaining({ kind: "after", value: 2 }),
		]);
	});

	it("journals a ui action the same way it journals a step", async () => {
		const r = new MemoryRepl({
			extensions: [
				extension((hooks) => {
					hooks.invoke.use(async (ctx) => {
						recording(ctx.interp.channels, "view", ctx.action);
					});
				}),
			],
		});

		expect((await r.invokeUi("a1")).entries).toEqual([
			expect.objectContaining({ kind: "view", value: "a1" }),
		]);
	});

	it("journals nothing when no extension records", async () => {
		const r = new MemoryRepl({ extensions: [] });

		expect((await r.evalOutput("(+ 1 1)")).entries).toEqual([]);
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
	function turn(r: AgentRepl): AgentTurn {
		return {
			interp: r.interp,
			threadId: "thread",
			turnId: "turn",
			prompt: "what is 1 + 2?",
			provider: "test",
			model: "test",
		};
	}

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

	it("settles as the loop asked when nobody hooks it", async () => {
		const r = new AgentRepl({ extensions: [] });

		expect(await r.beforeSettle(false)).toEqual({
			more: false,
			notes: [],
			entries: [],
		});
		expect(await r.beforeSettle(true)).toMatchObject({
			more: true,
			notes: [],
		});
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

	it("hands over what it recorded as the turn settles, and only once", async () => {
		const r = new AgentRepl({
			extensions: [
				extension((hooks) => {
					hooks.beforeSettle.use(function* (ctx, more, next) {
						recording(ctx.interp.channels, "closed", "wrapped");
						return yield* next(ctx, more);
					});
				}),
			],
		});

		expect((await r.beforeSettle(false)).entries).toEqual([
			expect.objectContaining({ kind: "closed", value: "wrapped" }),
		]);
		expect((await r.evalOutput("(+ 1 2)")).entries).toEqual([]);
	});

	it("sees how the turn ended", () => {
		const outcomes: [TurnOutcome, number][] = [];
		const r = new AgentRepl({
			extensions: [
				extension((hooks) =>
					hooks.settled.use((t, end, next) => {
						outcomes.push([end.outcome, end.steps]);
						next(t, end);
					}),
				),
			],
		});

		r.settled(turn(r), {
			outcome: "halt",
			answer: "3",
			steps: 3,
			latencyMs: 1,
		});

		expect(outcomes).toEqual([["halt", 3]]);
	});
});
