import type { ModelDelta } from "@repo/interpreter/session";
import { describe, expect, it, vi } from "vitest";
import { replResultContent } from "../src/repl.ts";
import { runAgentTurn, type TurnEvent } from "../src/turn.ts";
import { extension, recording, testRepl } from "./helpers.ts";

const TURNS: ModelDelta[][] = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];

let turn = 0;
const sent: { content: string }[][] = [];

vi.mock("../src/agent.ts", () => ({
	streamAgent: async function* (messages: { content: string }[]) {
		sent.push(messages);
		for (const delta of TURNS[Math.min(turn++, TURNS.length - 1)]) yield delta;
	},
}));

const unread = { nested: ["anything", 7], at: "never interpreted" };

const journaling = extension((hooks) => {
	hooks.beginStep.use(function* (ctx, next) {
		recording(ctx.interp.channels, "before-model", unread);
		yield* next(ctx);
	});
	hooks.evalStep.use(async (ctx, next) => {
		recording(ctx.interp.channels, "during-step", ctx.code);
		await next(ctx);
		recording(ctx.interp.channels, "after-step", ctx.code);
	});
});

describe("the loop and the journal", () => {
	it("marks what each step recorded with the id of the step it is about", async () => {
		turn = 0;
		const events: TurnEvent[] = [];
		for await (const event of runAgentTurn(
			[{ role: "user", content: "what is 1 + 2?" }],
			{ repl: testRepl([journaling]) },
		))
			events.push(event);

		const steps = events.flatMap((e) =>
			e.type === "assistant" ? [e.stepId] : [],
		);
		const about = events.flatMap((e) =>
			e.type === "entry" ? [e.entry.about] : [],
		);
		expect(steps).toHaveLength(2);
		expect(about).toEqual([steps[0], steps[0], steps[0], steps[1], steps[1]]);
	});

	it("forwards every entry as it was recorded, in order, interpreting none", async () => {
		turn = 0;
		const events: TurnEvent[] = [];
		for await (const event of runAgentTurn(
			[{ role: "user", content: "what is 1 + 2?" }],
			{ repl: testRepl([journaling]) },
		))
			events.push(event);

		expect(
			events.flatMap((e) =>
				e.type === "entry"
					? [{ kind: e.entry.kind, value: e.entry.value }]
					: [],
			),
		).toEqual([
			{ kind: "before-model", value: unread },
			{ kind: "during-step", value: "(+ 1 2)" },
			{ kind: "after-step", value: "(+ 1 2)" },
			{ kind: "before-model", value: unread },
			{ kind: "during-step", value: "three." },
		]);
		expect(
			events
				.filter((e) => e.type !== "delta")
				.map((e) => (e.type === "entry" ? e.entry.kind : e.type)),
		).toEqual([
			"system",
			"before-model",
			"assistant",
			"during-step",
			"after-step",
			"result",
			"before-model",
			"assistant",
			"during-step",
			"halt",
		]);
	});

	it("never hands the model an entry, only the output in an envelope", async () => {
		expect(JSON.parse(replResultContent("out", true))).toEqual({
			type: "tool_result",
			source: "lisp-repl",
			error: true,
			output: "out",
		});
		expect(
			sent.flat().some((m) => m.content.includes("never interpreted")),
		).toBe(false);
		expect(sent.flat().some((m) => m.content.includes("during-step"))).toBe(
			false,
		);
	});
});
