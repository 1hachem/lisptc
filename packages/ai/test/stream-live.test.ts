import { topic } from "@repo/interpreter/channels";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import {
	annotating,
	type InterpExtension,
	type ModelDelta,
	type SessionHooks,
} from "@repo/interpreter/session";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { WireMessage } from "../src/stream.ts";
import { testRepl } from "./helpers.ts";

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

const progressed = topic<number>("progressed");

function progressing(): InterpExtension {
	return Object.assign(
		(interp: Interp): void => {
			interp.defineGlobal(
				newSym("progress"),
				interp.makeBuiltIn("progress", 1, (n: unknown) => {
					progressed.emit(interp.channels, { user: Number(n) });
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
		},
		{
			session(hooks: SessionHooks): void {
				hooks.annotate.use((buffer, into, next) => {
					const last = buffer.collect(progressed).at(-1);
					return next(
						buffer,
						last === undefined
							? into
							: annotating(into, "output", { progress: last }),
					);
				});
			},
		},
	);
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

const isLive = (m: WireMessage) => m.id.endsWith(":live");

describe("a step that is still running", () => {
	let streamChatResponse: typeof import("../src/stream.ts").streamChatResponse;

	beforeAll(async () => {
		({ streamChatResponse } = await import("../src/stream.ts"));
	});

	test("shows what it has annotated so far, until its result replaces it, and is never recorded", async () => {
		const recorded: WireMessage[] = [];
		const body = await streamChatResponse(
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

		const values = snapshots(body);
		const provisional = values
			.map((messages) => messages.find(isLive))
			.filter((m) => m !== undefined);
		const resultAt = values.findIndex((messages) =>
			messages.some((m) => m.type === "tool" && !isLive(m)),
		);
		const lastLiveAt = values.findLastIndex((messages) =>
			messages.some(isLive),
		);

		expect(provisional.map((m) => m.additional_kwargs)).toEqual([
			{ progress: 1 },
			{ progress: 2 },
		]);
		expect(provisional[0]).toMatchObject({ type: "tool", content: "" });
		expect(values[lastLiveAt].map((m) => m.type)).toEqual([
			"human",
			"ai",
			"tool",
		]);
		expect(lastLiveAt).toBeLessThan(resultAt);
		expect(values[resultAt].some(isLive)).toBe(false);
		expect(values.at(-1)?.some(isLive)).toBe(false);
		expect(recorded.some(isLive)).toBe(false);
		expect(
			recorded.find((m) => m.type === "tool")?.additional_kwargs,
		).toMatchObject({ progress: 2 });
	});
});
