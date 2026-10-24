import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentDelta } from "../src/agent.ts";
import { Conversation } from "../src/conversation.ts";
import { converse, DelegatedAsks } from "../src/delegate.ts";
import { holding, testRepl } from "./helpers.ts";

const model = vi.hoisted(() => ({
	script: [] as AgentDelta[][],
	calls: 0,
}));

vi.mock("../src/telemetry.ts", () => ({
	captureReplEval: () => {},
	captureTurn: () => {},
	captureLlmCall: () => {},
	captureException: () => {},
}));

vi.mock("../src/agent.ts", () => ({
	streamAgent: async function* () {
		const turn = model.script[Math.min(model.calls++, model.script.length - 1)];
		for (const delta of turn) yield delta;
	},
}));

beforeEach(() => {
	model.script = [];
	model.calls = 0;
});

const reply = () => ({ maxSteps: 5, signal: new AbortController().signal });

describe("a delegated conversation", () => {
	test("surfaces a held step, then carries on with what the user answered", async () => {
		model.script = [[{ text: "(wait-for-human)" }], [{ text: "done." }]];
		const repl = testRepl([holding()]);
		const asks = new DelegatedAsks();
		const surfaced: unknown[] = [];
		const answer = converse(
			new Conversation(repl, "help", async () => ({})),
			"go",
			reply,
			(held) => {
				surfaced.push(held.output);
				const waiting = asks.wait("ask-1", repl, new AbortController().signal);
				setTimeout(() => void asks.answer("ask-1", "approve", {}), 0);
				return waiting;
			},
		);
		expect(await answer).toBe("done.");
		expect(surfaced).toEqual([{ waiting: ["approve it"] }]);
		expect(asks.holds("ask-1")).toBe(false);
	});
});

describe("delegated asks", () => {
	test("refuse an answer nothing waits on", async () => {
		expect(await new DelegatedAsks().answer("nope", "approve", {})).toEqual({
			output: "nothing is waiting on this ask",
			error: true,
		});
	});

	test("let go of an ask whose sender gave up", async () => {
		const asks = new DelegatedAsks();
		const stop = new AbortController();
		const waiting = asks.wait("ask-1", testRepl([holding()]), stop.signal);
		stop.abort(new Error("cancelled"));
		await expect(waiting).rejects.toThrow("cancelled");
		expect(asks.holds("ask-1")).toBe(false);
	});
});
