import { type Entry, view } from "@repo/shared/journal";
import { describe, expect, test } from "vitest";
import { judgedKind, memoryKind } from "../src/memory.ts";

let ids = 0;
const entry = (kind: string, value: unknown): Entry => ({
	id: `e${++ids}`,
	kind,
	value,
});

describe("fired memories", () => {
	test("keep every memory that fired, in order", () => {
		expect(
			view(
				[
					entry("memory", { key: "a", body: "x" }),
					entry("memory", { key: "b", body: "y" }),
				],
				memoryKind,
			).map((m) => m.key),
		).toEqual(["a", "b"]);
	});

	test("reads back a memory with a key", () => {
		expect(
			view([entry("memory", { key: "a", body: "x" })], memoryKind),
		).toEqual([{ key: "a", body: "x" }]);
	});

	test("reads nothing from a memory without a key", () => {
		expect(view([entry("memory", { key: "" })], memoryKind)).toEqual([]);
	});
});

describe("the judged kind", () => {
	test("reads back the message, the score of each pattern, and an error", () => {
		const judged = {
			message: "how do I pay?",
			scores: { "user asks about billing": 0.9, "user asks about x": 0 },
		};
		expect(view([entry("judged", judged)], judgedKind)).toEqual([judged]);
		const failed = { message: "m", scores: {}, error: "timed out" };
		expect(view([entry("judged", failed)], judgedKind)).toEqual([failed]);
	});

	test("reads nothing from a score outside [0, 1] or not a number", () => {
		for (const a of [1.2, -0.1, "0.5"])
			expect(
				view([entry("judged", { message: "m", scores: { a } })], judgedKind),
			).toEqual([]);
	});
});
