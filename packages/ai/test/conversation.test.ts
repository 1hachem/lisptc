import { topic } from "@repo/interpreter/channels";
import { StepHold } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import {
	annotating,
	type InterpExtension,
	type SessionHooks,
} from "@repo/interpreter/session";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentDelta, AgentMessage } from "../src/agent.ts";
import { Conversation, ConversationStopped } from "../src/conversation.ts";
import type { TranscriptEntry } from "../src/repl.ts";
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

function conversation(
	extensions: InterpExtension[] = [],
	history: TranscriptEntry[] = [],
) {
	return new Conversation(
		testRepl(extensions),
		"You are a researcher.",
		async () => ({}),
		history,
	);
}

const waiting = topic<string>("waiting");

function holding(): InterpExtension {
	return Object.assign(
		(interp: Interp) => {
			interp.defineGlobal(
				newSym("wait-for-human"),
				interp.makeBuiltIn("wait-for-human", 0, () => {
					waiting.emit(interp.channels, { user: "approve it" });
					throw new StepHold("approve it");
				}),
			);
		},
		{
			session: (hooks: SessionHooks) =>
				hooks.annotate.use((buffer, into, next) => {
					const seen = buffer.collect(waiting);
					return next(
						buffer,
						seen.length === 0
							? into
							: annotating(into, "output", { waiting: seen }),
					);
				}),
		},
	);
}

const once = { maxSteps: 5, signal: new AbortController().signal };

describe("a conversation with an agent", () => {
	test("answers with the reply that ends the turn", async () => {
		model.script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];
		expect(await conversation().reply("add them", once)).toEqual({
			answer: "three.",
		});
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

	test("hands back what a held step asked instead of an answer", async () => {
		model.script = [[{ text: "(wait-for-human)" }], [{ text: "never." }]];
		expect(await conversation([holding()]).reply("go", once)).toEqual({
			held: expect.objectContaining({
				output: { waiting: ["approve it"] },
			}),
		});
	});

	test("starts from a chat it was forked from", async () => {
		model.script = [[{ text: "done." }]];
		await conversation(
			[],
			[
				{ role: "user", content: "earlier ask" },
				{ role: "assistant", content: "earlier reply" },
			],
		).reply("now", once);
		expect(model.seen[0].messages.map((m) => m.content)).toEqual(
			expect.arrayContaining(["earlier ask", "earlier reply", "now"]),
		);
	});
});
