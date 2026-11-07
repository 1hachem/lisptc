import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import type { InterpExtension, ModelDelta } from "@repo/interpreter/session";
import { ENTRY_TYPE } from "@repo/shared/journal";
import { describe, expect, test, vi } from "vitest";
import type { WireMessage } from "../src/stream.ts";
import { recording, streamChat, testRepl, unprompted } from "./helpers.ts";

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
			newSym("doing"),
			interp.makeBuiltIn("doing", 1, (n: unknown) => {
				recording(interp.channels, "doing", Number(n), true);
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
	unprompted(messages).map((m) =>
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

describe("a step that keeps restating one fact", () => {
	test("stores one row for it, holding the last value, and sends fewer snapshots than it recorded entries", async () => {
		TURNS[0] = [
			{
				text: "(doing 1) (doing 2) (doing 3) (doing 4) (doing 5) (pause 250)",
			},
		];
		turn = 0;
		const recorded: WireMessage[] = [];
		const body = await streamChat(
			{ messages: [{ type: "human", content: "work" }] },
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

		expect(shape(recorded)).toEqual(["ai", "entry:5", "tool", "ai"]);
		const live = snapshots(body).filter((m) =>
			m.some((message) => message.type === ENTRY_TYPE),
		);
		expect(live.length).toBeLessThan(5);
	});
});
