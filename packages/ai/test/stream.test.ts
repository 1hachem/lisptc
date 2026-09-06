import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentDelta } from "../src/agent.ts";

const TURNS: AgentDelta[][] = [
	[{ text: "(+ 1 2)" }, { usage: { input: 10, output: 4 } }],
	[{ text: "three." }, { usage: { input: 20, output: 6, cachedInput: 10 } }],
];

let turn = 0;

vi.mock("../src/agent.ts", () => ({
	streamAgent: async function* () {
		for (const delta of TURNS[Math.min(turn++, TURNS.length - 1)]) yield delta;
	},
}));

interface WireMessage {
	type: string;
	content: string;
	additional_kwargs?: {
		meta?: {
			at?: string;
			durationMs?: number;
			inputTokens?: number;
			outputTokens?: number;
			cachedInputTokens?: number;
			steps?: number;
		};
	};
}

async function finalMessages(response: Response): Promise<WireMessage[]> {
	const text = await response.text();
	const values = text
		.split("\n\n")
		.filter((record) => record.startsWith("event: values"))
		.map(
			(record) =>
				JSON.parse(record.slice(record.indexOf("data: ") + 6)) as {
					messages: WireMessage[];
				},
		);
	return values[values.length - 1].messages;
}

describe("chat stream", () => {
	beforeEach(() => {
		turn = 0;
	});

	test("every model call reports what it cost, and only its own", async () => {
		const { streamChatResponse } = await import("../src/stream.ts");
		const messages = await finalMessages(
			streamChatResponse({
				messages: [{ type: "human", content: "what is 1 + 2?" }],
			}),
		);

		const assistant = messages.filter((m) => m.type === "ai");
		expect(assistant.map((m) => m.content)).toEqual(["(+ 1 2)", "three."]);

		const step = assistant[0].additional_kwargs?.meta;
		expect(step).toMatchObject({ inputTokens: 10, outputTokens: 4 });
		expect(typeof step?.durationMs).toBe("number");
		expect(Date.parse(step?.at ?? "")).not.toBeNaN();
		expect(step?.cachedInputTokens).toBeUndefined();
		expect(step?.steps).toBeUndefined();

		const answer = assistant[1].additional_kwargs?.meta;
		expect(answer).toMatchObject({
			inputTokens: 20,
			outputTokens: 6,
			cachedInputTokens: 10,
			steps: 2,
		});
	});

	test("a REPL result carries no cost of its own", async () => {
		const { streamChatResponse } = await import("../src/stream.ts");
		const messages = await finalMessages(
			streamChatResponse({
				messages: [{ type: "human", content: "what is 1 + 2?" }],
			}),
		);

		const tool = messages.find((m) => m.type === "tool");
		expect(tool?.additional_kwargs?.meta).toBeUndefined();
	});
});
