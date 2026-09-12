import { providerSpecs } from "@repo/env/providers";
import { DEFAULT_PROVIDER } from "@repo/shared/providers";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
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
			provider?: string;
			model?: string;
			inputTokens?: number;
			outputTokens?: number;
			cachedInputTokens?: number;
			steps?: number;
		};
	};
}

function records(text: string): { event: string; data: unknown }[] {
	return text
		.split("\n\n")
		.filter((record) => record.startsWith("event: "))
		.map((record) => ({
			event: record.slice(7, record.indexOf("\n")),
			data: JSON.parse(record.slice(record.indexOf("data: ") + 6)),
		}));
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
	let streamChatResponse: typeof import("../src/stream.ts").streamChatResponse;

	beforeAll(async () => {
		({ streamChatResponse } = await import("../src/stream.ts"));
	});

	beforeEach(() => {
		turn = 0;
	});

	test("every model call reports what it cost, and only its own", async () => {
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

	test("every model call names the model that was billed for it", async () => {
		const messages = await finalMessages(
			streamChatResponse(
				{ messages: [{ type: "human", content: "what is 1 + 2?" }] },
				{ provider: "fireworks", model: "a-pinned-one" },
			),
		);

		for (const m of messages.filter((m) => m.type === "ai"))
			expect(m.additional_kwargs?.meta).toMatchObject({
				provider: "fireworks",
				model: "a-pinned-one",
			});
	});

	test("an unpinned call names the default it actually ran on", async () => {
		const messages = await finalMessages(
			streamChatResponse({
				messages: [{ type: "human", content: "what is 1 + 2?" }],
			}),
		);

		expect(
			messages.find((m) => m.type === "ai")?.additional_kwargs?.meta,
		).toMatchObject({
			provider: DEFAULT_PROVIDER,
			model: providerSpecs[DEFAULT_PROVIDER].defaultModel,
		});
	});

	test("a REPL result carries no cost of its own", async () => {
		const messages = await finalMessages(
			streamChatResponse({
				messages: [{ type: "human", content: "what is 1 + 2?" }],
			}),
		);

		const tool = messages.find((m) => m.type === "tool");
		expect(tool?.additional_kwargs?.meta).toBeUndefined();
	});
	test("the wire contract the app reads", async () => {
		const text = await streamChatResponse({
			messages: [{ type: "human", content: "what is 1 + 2?" }],
		}).text();
		const seen = records(text);

		expect(new Set(seen.map((r) => r.event))).toEqual(
			new Set(["values", "messages"]),
		);

		const delta = seen.find((r) => r.event === "messages")?.data as unknown[];
		expect(delta).toHaveLength(2);
		expect(delta[1]).toEqual({});
		expect(delta[0]).toMatchObject({ type: "ai", content: "(+ 1 2)" });

		const snapshot = seen.at(-1)?.data as { messages: WireMessage[] };
		expect(snapshot.messages.map((m) => m.type)).toEqual([
			"human",
			"ai",
			"tool",
			"ai",
		]);
	});
});
