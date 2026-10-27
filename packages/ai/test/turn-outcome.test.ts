import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentDelta } from "../src/agent.ts";
import type { TurnOutcome } from "../src/stream.ts";
import {
	type ChatStreamOptions,
	holding,
	streamChat,
	testRepl,
} from "./helpers.ts";

const model = vi.hoisted(() => ({
	script: [] as AgentDelta[][],
	calls: 0,
	systems: [] as (string | undefined)[],
}));

vi.mock("../src/telemetry.ts", () => ({
	captureReplEval: () => {},
	captureTurn: () => {},
	captureLlmCall: () => {},
	captureException: () => {},
}));

vi.mock("../src/agent.ts", () => ({
	streamAgent: async function* (
		_messages: unknown,
		config?: { system?: string },
	) {
		model.systems.push(config?.system);
		const turn = model.script[Math.min(model.calls++, model.script.length - 1)];
		for (const delta of turn) yield delta;
	},
}));

beforeEach(() => {
	model.script = [];
	model.calls = 0;
	model.systems.length = 0;
});

async function outcomeOf(
	options: Partial<ChatStreamOptions> = {},
): Promise<TurnOutcome | undefined> {
	let outcome: TurnOutcome | undefined;
	const response = streamChat(
		{ messages: [{ type: "human", content: "go" }] },
		{
			repl: testRepl(),
			...options,
			onOutcome: (ended) => {
				outcome = ended;
			},
		},
	);
	await response.text();
	return outcome;
}

describe("how a turn ended", () => {
	test("answers with the reply that ends the turn", async () => {
		model.script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];
		expect(await outcomeOf()).toEqual({ answer: "three." });
	});

	test("hands back what a held step asked instead of an answer", async () => {
		model.script = [[{ text: "(wait-for-human)" }], [{ text: "never." }]];
		expect(await outcomeOf({ repl: testRepl([holding()]) })).toEqual({
			held: expect.objectContaining({ output: { waiting: ["approve it"] } }),
			message: expect.any(String),
		});
	});

	test("stops when the step budget runs out before an answer", async () => {
		model.script = [[{ text: "(+ 1 2)" }]];
		expect(await outcomeOf({ maxSteps: 2 })).toEqual({
			stopped: "used its 2 steps without answering",
		});
	});

	test("puts its instructions after the system prompt", async () => {
		model.script = [[{ text: "done." }]];
		await outcomeOf({ config: { instructions: "You are a researcher." } });
		expect(model.systems[0]?.endsWith("\n\nYou are a researcher.")).toBe(true);
	});
});
