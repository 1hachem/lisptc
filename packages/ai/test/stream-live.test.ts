import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import type { InterpExtension, ModelDelta } from "@repo/interpreter/session";
import { ENTRY_TYPE } from "@repo/shared/messages";
import { describe, expect, test, vi } from "vitest";
import type { WireMessage } from "../src/stream.ts";
import { recording, streamChat, testRepl } from "./helpers.ts";

const TURNS: ModelDelta[][] = [
	[{ text: "(progress 1) (pause 250) (progress 2) (pause 250)" }],
	[{ text: "done." }],
];

let turn = 0;

vi.mock("../src/agent.ts", () => ({
	streamAgent: async function* () {
		for (const delta of TURNS[Math.min(turn++, TURNS.length - 1)]) yield delta;
	},
}));

function progressing(): InterpExtension {
	return (interp: Interp): void => {
		interp.defineGlobal(
			newSym("progress"),
			interp.makeBuiltIn("progress", 1, (n: unknown) => {
				recording(interp.channels, "progress", Number(n));
				return 0;
			}),
		);
		interp.defineGlobal(
			newSym("pause"),
			interp.makeBuiltIn(
				"pause",
				1,
				(ms: unknown) =>
					new Promise((resolve) => setTimeout(() => resolve(0), Number(ms))),
			),
		);
	};
}

function snapshots(text: string): WireMessage[][] {
	return text
		.split("\n\n")
		.filter((record) => record.startsWith("event: values"))
		.map(
			(record) =>
				(
					JSON.parse(record.slice(record.indexOf("data: ") + 6)) as {
						messages: WireMessage[];
					}
				).messages,
		);
}

const shape = (messages: WireMessage[]) =>
	messages.map((m) =>
		m.type === ENTRY_TYPE ? `entry:${m.additional_kwargs?.value}` : m.type,
	);

describe("a step that is still running", () => {
	test("journals each entry as its own row the moment it is recorded, before the step's result, and records every row once", async () => {
		const recorded: WireMessage[] = [];
		const body = await streamChat(
			{ messages: [{ type: "human", content: "count to two" }] },
			{
				repl: testRepl([progressing()]),
				onStep: (produced) => {
					recorded.push(...produced);
				},
				onTurn: (rest) => {
					recorded.push(...rest);
				},
			},
		).text();

		const values = snapshots(body).map(shape);

		expect(values).toContainEqual(["human", "ai", "entry:1"]);
		expect(values).toContainEqual(["human", "ai", "entry:1", "entry:2"]);
		expect(values.at(-1)).toEqual([
			"human",
			"ai",
			"entry:1",
			"entry:2",
			"tool",
			"ai",
		]);
		expect(shape(recorded)).toEqual(["ai", "entry:1", "entry:2", "tool", "ai"]);
		expect(new Set(recorded.map((m) => m.id)).size).toBe(recorded.length);
	});
});
