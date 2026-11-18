import type { ModelDelta } from "@repo/interpreter/session";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WireMessage } from "../src/line.ts";
import {
	extension,
	recording,
	streamChat,
	testRepl,
	unprompted,
} from "./helpers.ts";

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
		recording(ctx.interp.journal, "before-model", unread);
		yield* next(ctx);
	});
	hooks.evalStep.use(async (ctx, next) => {
		recording(ctx.interp.journal, "during-step", ctx.code);
		await next(ctx);
		recording(ctx.interp.journal, "after-step", ctx.code);
	});
});

async function finalMessages(): Promise<WireMessage[]> {
	const text = await streamChat(
		{ messages: [{ type: "human", content: "what is 1 + 2?" }] },
		{ repl: testRepl([journaling]) },
	).text();
	const last = text
		.split("\n\n")
		.filter((record) => record.startsWith("event: values"))
		.at(-1);
	return unprompted(
		(
			JSON.parse(last?.slice(last.indexOf("data: ") + 6) ?? "{}") as {
				messages: WireMessage[];
			}
		).messages,
	);
}

describe("the loop and the journal", () => {
	beforeEach(() => {
		turn = 0;
		sent.length = 0;
	});

	it("marks what each step recorded with the id of the step it is about", async () => {
		const messages = await finalMessages();

		const steps = messages.filter((m) => m.type === "ai").map((m) => m.id);
		const about = messages
			.filter((m) => m.type === "entry")
			.map((m) => m.additional_kwargs?.about);
		expect(steps).toHaveLength(2);
		expect(about).toEqual([steps[0], steps[0], steps[0], steps[1], steps[1]]);
	});

	it("forwards every entry as it was recorded, in order, interpreting none", async () => {
		const messages = await finalMessages();

		expect(
			messages.map((m) =>
				m.type === "entry"
					? {
							kind: m.additional_kwargs?.kind,
							value: m.additional_kwargs?.value,
						}
					: m.type,
			),
		).toEqual([
			"human",
			{ kind: "before-model", value: unread },
			"ai",
			{ kind: "during-step", value: "(+ 1 2)" },
			{ kind: "after-step", value: "(+ 1 2)" },
			"tool",
			{ kind: "before-model", value: unread },
			"ai",
			{ kind: "during-step", value: "three." },
		]);
	});

	it("never hands the model an entry", async () => {
		await finalMessages();

		expect(sent).toHaveLength(2);
		expect(
			sent.flat().some((m) => m.content.includes("never interpreted")),
		).toBe(false);
		expect(sent.flat().some((m) => m.content.includes("during-step"))).toBe(
			false,
		);
	});
});
