import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
	annotate,
	annotationKey,
	memoriesKey,
	readAnnotation,
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
