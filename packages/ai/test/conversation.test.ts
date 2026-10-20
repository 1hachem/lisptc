import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentDelta, AgentMessage } from "../src/agent.ts";
import { Conversation, ConversationStopped } from "../src/conversation.ts";
import { testRepl } from "./helpers.ts";

const model = vi.hoisted(() => ({
	script: [] as AgentDelta[][],
	calls: 0,
	seen: [] as { messages: AgentMessage[]; system?: string }[],
}));

vi.mock("../src/telemetry.ts", () => ({
	captureReplEval: () => {},
	captureTurn: () => {},
	captureLlmCall: () => {},
	captureException: () => {},
}));

vi.mock("../src/agent.ts", () => ({
	streamAgent: async function* (
		messages: AgentMessage[],
		config?: { system?: string },
	) {
		model.seen.push({ messages: [...messages], system: config?.system });
		const turn = model.script[Math.min(model.calls++, model.script.length - 1)];
		for (const delta of turn) yield delta;
	},
}));

beforeEach(() => {
	model.script = [];
	model.calls = 0;
	model.seen.length = 0;
});

function conversation() {
	return new Conversation(
		testRepl(),
		"You are a researcher.",
		async () => ({}),
	);
}

const once = { maxSteps: 5, signal: new AbortController().signal };

describe("a conversation with an agent", () => {
	test("answers with the reply that ends the turn", async () => {
		model.script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];
		expect(await conversation().reply("add them", once)).toBe("three.");
	});

	test("puts its instructions after the system prompt", async () => {
		model.script = [[{ text: "done." }]];
		await conversation().reply("hi", once);
		expect(model.seen[0].system?.endsWith("\n\nYou are a researcher.")).toBe(
			true,
		);
	});

	test("remembers the earlier exchange on the next message", async () => {
		model.script = [[{ text: "first." }], [{ text: "second." }]];
		const talk = conversation();
		await talk.reply("one", once);
		await talk.reply("two", once);
		const contents = model.seen[1].messages.map((m) => m.content);
		expect(contents).toEqual(expect.arrayContaining(["one", "first.", "two"]));
	});

	test("stops when the step budget runs out before an answer", async () => {
		model.script = [[{ text: "(+ 1 2)" }]];
		await expect(
			conversation().reply("loop", { ...once, maxSteps: 2 }),
		).rejects.toThrow(ConversationStopped);
	});
});
