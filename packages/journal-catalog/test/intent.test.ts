import { type Entry, view } from "@repo/shared/journal";
import { describe, expect, test } from "vitest";
import { intentKind, questionKind } from "../src/intent.ts";

let ids = 0;
const entry = (kind: string, value: unknown): Entry => ({
	id: `e${++ids}`,
	kind,
	value,
});

describe("intent and question kinds", () => {
	const intent = (value: unknown) => view([entry("intent", value)], intentKind);

	test("read back an intent and a question of the right shape", () => {
		const doing = { doing: "d", todos: [{ label: "a", done: true }] };
		const question = { id: "q1", prompt: "p", choices: ["A"], multi: false };
		expect(intent(doing)).toEqual(doing);
		expect(view([entry("question", question)], questionKind)).toEqual(question);
	});

	test("read nothing from an intent of the wrong shape", () => {
		expect(intent("busy")).toBeUndefined();
		expect(intent({ todos: [{ label: "a" }] })).toBeUndefined();
		expect(intent({ doing: 3 })).toBeUndefined();
	});

	test("read back an intent with progress, label optional", () => {
		const bare = { progress: { done: 0, total: 3 } };
		const labelled = { progress: { done: 3, total: 3, label: "files" } };
		expect(intent(bare)).toEqual(bare);
		expect(intent(labelled)).toEqual(labelled);
	});

	test("read nothing from an intent whose progress is out of range", () => {
		for (const progress of [
			{ done: 4, total: 3 },
			{ done: 0, total: 0 },
			{ done: -1, total: 3 },
			{ done: 1.5, total: 3 },
			{ done: 1, total: 3, label: 7 },
		])
			expect(intent({ progress })).toBeUndefined();
	});

	test("read back an intent with the log of its doing lines", () => {
		const logged = {
			doing: "b",
			log: [
				{ text: "a", startedAt: 1000, ms: 250, state: "done" },
				{ text: "b", startedAt: 1250, state: "running" },
			],
		};
		expect(intent(logged)).toEqual(logged);
	});

	test("read nothing from an intent whose log is malformed", () => {
		for (const step of [
			{ text: "a", startedAt: 1000, state: "started" },
			{ text: "a", state: "running" },
			{ text: 3, startedAt: 1000, state: "running" },
			{ text: "a", startedAt: 1000, ms: "1s", state: "done" },
		])
			expect(intent({ log: [step] })).toBeUndefined();
	});

	test("read nothing from a question of the wrong shape", () => {
		const question = { id: "q1", prompt: "p", choices: ["A"], multi: false };
		const read = (value: unknown) =>
			view([entry("question", value)], questionKind);
		expect(read({ ...question, choices: [] })).toBeUndefined();
		expect(read({ ...question, multi: "no" })).toBeUndefined();
		expect(read({ prompt: "p" })).toBeUndefined();
	});
});
