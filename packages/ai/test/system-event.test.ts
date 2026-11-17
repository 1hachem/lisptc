import type { ModelDelta } from "@repo/interpreter/session";
import type { ChatMessage } from "@repo/shared/messages";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { lineWire, type WireMessage } from "../src/line.ts";
import { streamChat, testRepl, unprompted } from "./helpers.ts";

const seen: ChatMessage[][] = [];

vi.mock("../src/agent.ts", () => ({
	streamAgent: async function* (
		messages: ChatMessage[],
	): AsyncGenerator<ModelDelta> {
		seen.push(messages);
		yield { text: "carrying on." };
	},
}));

const NOTE = 'I approved (fs/write "a"). Carry on.';

describe("a turn started by a system event", () => {
	beforeEach(() => {
		seen.length = 0;
	});

	test("runs, and the model reads the event as a developer message naming its source", async () => {
		const recorded: WireMessage[] = [];
		const event = lineWire(
			{
				kind: "record",
				record: { role: "user", source: "permissions/decide", content: NOTE },
			},
			"e1",
		);
		const response = streamChat(
			{
				messages: [
					{ type: "human", content: "write a" },
					{ type: "ai", content: '(fs/write "a")' },
					event,
				],
			},
			{
				repl: testRepl(),
				onTurn: (messages) => {
					recorded.push(...messages);
				},
			},
		);
		await response.text();

		expect(seen).toHaveLength(1);
		expect(seen[0].at(-1)).toEqual({
			role: "developer",
			content: `from permissions/decide:\n${NOTE}`,
		});
		expect(unprompted(recorded).map((m) => m.type)).toEqual(["ai"]);
	});

	test("echoes the event on the wire as a system message carrying its source", async () => {
		const response = streamChat(
			{
				messages: [
					lineWire(
						{
							kind: "record",
							record: {
								role: "user",
								source: "oauth",
								content: "linear connected",
							},
						},
						"e2",
					),
				],
			},
			{ repl: testRepl() },
		);
		const text = await response.text();
		const first = text
			.split("\n\n")
			.find((record) => record.startsWith("event: values"));
		const values = JSON.parse(
			first?.slice(first.indexOf("data: ") + 6) ?? "{}",
		) as { messages: WireMessage[] };
		expect(values.messages[0]).toEqual({
			type: "system",
			content: "linear connected",
			id: "e2",
			additional_kwargs: { source: "oauth" },
		});
	});
});
