import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
	activityKey,
	annotate,
	annotationKey,
	intentKey,
	memoriesKey,
	questionKey,
	readAnnotation,
	recordActivity,
	viewKey,
} from "../src/annotations.ts";
import { answering, asksKey, unansweredAsks } from "../src/asks.ts";
import { noAnnotations } from "../src/session.ts";

describe("an annotation key", () => {
	test("writes into its own lane and reads back what it wrote", () => {
		const memories = [{ key: "k", body: "b" }];
		const into = annotate(noAnnotations(), memoriesKey, memories);
		expect(into.output).toEqual({});
		expect(readAnnotation(into.step, memoriesKey)).toEqual(memories);
	});

	test("may not take a name the message envelope owns", () => {
		expect(() =>
			annotationKey({ name: "display", lane: "output", schema: z.string() }),
		).toThrow(/envelope/);
	});

	test("reads nothing from a value of the wrong shape", () => {
		expect(readAnnotation({ ui: "a string" }, viewKey)).toBeUndefined();
		expect(readAnnotation({ memories: [] }, memoriesKey)).toBeUndefined();
		expect(readAnnotation({ asks: 3 }, asksKey)).toBeUndefined();
		expect(readAnnotation(undefined, asksKey)).toBeUndefined();
	});

	test("reads a whole view, and nothing from one with a malformed child", () => {
		const card = { tag: "card", props: { title: "t" }, children: [] };
		expect(readAnnotation({ ui: card }, viewKey)).toEqual(card);
		expect(
			readAnnotation({ ui: { ...card, children: [{ no: 1 }] } }, viewKey),
		).toBeUndefined();
	});
});

describe("intent and question keys", () => {
	test("read back an intent and a question of the right shape", () => {
		const intent = { doing: "d", todos: [{ label: "a", done: true }] };
		const question = { id: "q1", prompt: "p", choices: ["A"], multi: false };
		expect(readAnnotation({ intent }, intentKey)).toEqual(intent);
		expect(readAnnotation({ question }, questionKey)).toEqual(question);
	});

	test("read nothing from an intent of the wrong shape", () => {
		expect(readAnnotation({ intent: "busy" }, intentKey)).toBeUndefined();
		expect(
			readAnnotation({ intent: { todos: [{ label: "a" }] } }, intentKey),
		).toBeUndefined();
		expect(readAnnotation({ intent: { doing: 3 } }, intentKey)).toBeUndefined();
	});

	test("read back an intent with progress, label optional", () => {
		const bare = { progress: { done: 0, total: 3 } };
		const labelled = { progress: { done: 3, total: 3, label: "files" } };
		expect(readAnnotation({ intent: bare }, intentKey)).toEqual(bare);
		expect(readAnnotation({ intent: labelled }, intentKey)).toEqual(labelled);
	});

	test("read nothing from an intent whose progress is out of range", () => {
		for (const progress of [
			{ done: 4, total: 3 },
			{ done: 0, total: 0 },
			{ done: -1, total: 3 },
			{ done: 1.5, total: 3 },
			{ done: 1, total: 3, label: 7 },
		])
			expect(
				readAnnotation({ intent: { progress } }, intentKey),
			).toBeUndefined();
	});

	test("read back an intent with the log of its doing lines", () => {
		const intent = {
			doing: "b",
			log: [
				{ text: "a", startedAt: 1000, ms: 250, state: "done" },
				{ text: "b", startedAt: 1250, state: "running" },
			],
		};
		expect(readAnnotation({ intent }, intentKey)).toEqual(intent);
	});

	test("read nothing from an intent whose log is malformed", () => {
		for (const step of [
			{ text: "a", startedAt: 1000, state: "started" },
			{ text: "a", state: "running" },
			{ text: 3, startedAt: 1000, state: "running" },
			{ text: "a", startedAt: 1000, ms: "1s", state: "done" },
		])
			expect(
				readAnnotation({ intent: { log: [step] } }, intentKey),
			).toBeUndefined();
	});

	test("read nothing from a question of the wrong shape", () => {
		const question = { id: "q1", prompt: "p", choices: ["A"], multi: false };
		expect(
			readAnnotation({ question: { ...question, choices: [] } }, questionKey),
		).toBeUndefined();
		expect(
			readAnnotation({ question: { ...question, multi: "no" } }, questionKey),
		).toBeUndefined();
		expect(
			readAnnotation({ question: { prompt: "p" } }, questionKey),
		).toBeUndefined();
	});
});

describe("asks read through their key", () => {
	const open = [{ id: "a1", title: "t", prompt: "p", choices: [] }];

	test("are unanswered until an answer for their id is recorded", () => {
		const asks = readAnnotation({ asks: { open } }, asksKey);
		expect(unansweredAsks(asks).map((a) => a.id)).toEqual(["a1"]);
		const answered = answering(asks, "a1", { accepted: true, label: "ok" });
		expect(unansweredAsks(answered)).toEqual([]);
	});

	test("read nothing when an answer is not an answer", () => {
		expect(
			readAnnotation(
				{ asks: { open, answered: { a1: { accepted: "yes" } } } },
				asksKey,
			),
		).toBeUndefined();
	});
});

describe("recordActivity", () => {
	const started = (id: string, label = id) => ({
		kind: "mcp",
		label,
		state: "started" as const,
		id,
	});

	test("appends to the activity already annotated rather than replacing it", () => {
		const first = recordActivity(noAnnotations(), [started("a")]);
		const both = recordActivity(first, [started("b")]);
		expect(readAnnotation(both.output, activityKey)?.map((e) => e.id)).toEqual([
			"a",
			"b",
		]);
	});

	test("lets a later state of the same id replace its started in place", () => {
		const into = recordActivity(noAnnotations(), [
			started("a"),
			started("b"),
			{ ...started("a"), state: "done", detail: "d" },
		]);
		expect(readAnnotation(into.output, activityKey)).toEqual([
			{ kind: "mcp", label: "a", state: "done", detail: "d", id: "a" },
			started("b"),
		]);
	});

	test("keeps the start time of a started entry when its end carries only the duration", () => {
		const into = recordActivity(noAnnotations(), [
			{ ...started("a"), startedAt: 1000 },
			{ ...started("a"), state: "failed", ms: 40 },
		]);
		expect(readAnnotation(into.output, activityKey)).toEqual([
			{ ...started("a"), state: "failed", startedAt: 1000, ms: 40 },
		]);
	});

	test("leaves the annotations untouched when there is nothing to record", () => {
		const into = noAnnotations();
		expect(recordActivity(into, [])).toBe(into);
	});

	test("reads nothing from an empty or malformed activity", () => {
		expect(readAnnotation({ activity: [] }, activityKey)).toBeUndefined();
		expect(
			readAnnotation(
				{ activity: [{ ...started("a"), state: "x" }] },
				activityKey,
			),
		).toBeUndefined();
	});
});
