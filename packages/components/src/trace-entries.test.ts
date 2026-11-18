import { describe, expect, test } from "vitest";
import { foldEntries } from "./trace-entries.ts";
import type { ChatMessage } from "./trace-message.ts";

const row = (id: string, kind: string, value: unknown, extra = {}) =>
	({
		id,
		type: "entry",
		content: "",
		additional_kwargs: { kind, value, ...extra },
	}) as ChatMessage;

const shape = (messages: ChatMessage[]) =>
	messages.map((m) => [m.id, m.type, (m.entries ?? []).map((e) => e.kind)]);

describe("folding the journal into a chat", () => {
	test("hands what a step recorded to the result it ran into", () => {
		expect(
			shape(
				foldEntries([
					{ id: "h", type: "human", content: "go" },
					{ id: "a", type: "ai", content: "(x)" },
					row("e1", "intent", {}),
					{ id: "t", type: "tool", content: "" },
				]),
			),
		).toEqual([
			["h", "human", []],
			["a", "ai", []],
			["t", "tool", ["intent"]],
		]);
	});

	test("gives what an answering step recorded a quiet carrier of its own", () => {
		const folded = foldEntries([
			{ id: "a", type: "ai", content: "(answer)" },
			row("e1", "ui", { viewId: "v1" }),
		]);
		expect(shape(folded)).toEqual([
			["a", "ai", []],
			["e1:entries", "tool", ["ui"]],
		]);
		expect(folded[1]?.additional_kwargs).toEqual({ quiet: true });
	});

	test("hands an answer recorded later to the message it is about", () => {
		expect(
			shape(
				foldEntries([
					{ id: "t", type: "tool", content: "" },
					{ id: "a", type: "ai", content: "done" },
					{ id: "h", type: "human", content: "next" },
					row("e1", "asks", { answered: {} }, { about: "t" }),
				]),
			),
		).toEqual([
			["t", "tool", ["asks"]],
			["a", "ai", []],
			["h", "human", []],
		]);
	});

	test("hands what a step recorded to its result by the step's id, wherever the row sits", () => {
		expect(
			shape(
				foldEntries([
					{ id: "h", type: "human", content: "go" },
					row("e0", "memory", {}, { about: "s2" }),
					{ id: "s1", type: "ai", content: "(x)" },
					{ id: "t1", type: "tool", content: "" },
					row("e1", "intent", {}, { about: "s2" }),
					{ id: "s2", type: "ai", content: "(y)" },
					{ id: "t2", type: "tool", content: "" },
				]),
			),
		).toEqual([
			["h", "human", []],
			["s1", "ai", []],
			["t1", "tool", []],
			["s2", "ai", []],
			["t2", "tool", ["memory", "intent"]],
		]);
	});

	test("gives a step that has no result yet a quiet carrier, so what it records shows while it runs", () => {
		expect(
			shape(
				foldEntries([
					{ id: "h", type: "human", content: "go" },
					{ id: "s1", type: "ai", content: "(work)" },
					row("e1", "intent", {}, { about: "s1" }),
				]),
			),
		).toEqual([
			["h", "human", []],
			["s1", "ai", []],
			["e1:entries", "tool", ["intent"]],
		]);
	});

	test("keeps a standing entry on a line of its own even when it names its step", () => {
		expect(
			shape(
				foldEntries(
					[
						{ id: "s1", type: "ai", content: "(x)" },
						row("e1", "memory", {}, { about: "s1" }),
						{ id: "t1", type: "tool", content: "" },
					],
					(entry) => (entry.kind === "memory" ? "standing" : "carried"),
				),
			),
		).toEqual([
			["s1", "ai", []],
			["e1", "entry", []],
			["t1", "tool", []],
		]);
	});

	test("hands a sub-agent's held ask to the message that surfaced it", () => {
		expect(
			shape(
				foldEntries([
					{
						id: "w",
						type: "tool",
						content: "waiting",
						additional_kwargs: { thread: "c", holding: "x" },
					},
					{ id: "t", type: "tool", content: "" },
					row("e1", "asks", { open: [] }, { thread: "c", holding: "x" }),
				]),
			),
		).toEqual([
			["w", "tool", ["asks"]],
			["t", "tool", []],
		]);
	});

	test("keeps a standing entry in place and drops what the view leaves out", () => {
		const folded = foldEntries(
			[
				row("m", "memory", { key: "k", body: "b" }),
				row("j", "recognized", { message: "hi", scores: {} }),
				{ id: "a", type: "ai", content: "(x)" },
			],
			(entry) => (entry.kind === "memory" ? "standing" : "dropped"),
		);
		expect(shape(folded)).toEqual([
			["m", "entry", []],
			["a", "ai", []],
		]);
	});
});
