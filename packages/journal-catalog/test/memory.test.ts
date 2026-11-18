import { type Entry, view } from "@repo/shared/journal";
import { describe, expect, test } from "vitest";
import { memoryKind, recognizedKind } from "../src/memory.ts";

let ids = 0;
const entry = (kind: string, value: unknown): Entry => ({
	id: `e${++ids}`,
	kind,
	value,
});

describe("fired memories", () => {
	test("reads nothing from a memory without a key", () => {
		expect(view([entry("memory", { key: "" })], memoryKind)).toEqual([]);
	});
});

describe("the recognized kind", () => {
	test("reads back the message, the score of each pattern, and an error", () => {
		const recognized = {
			message: "how do I pay?",
			scores: { "user asks about billing": 0.9, "user asks about x": 0 },
		};
		expect(view([entry("recognized", recognized)], recognizedKind)).toEqual([
			recognized,
		]);
		const failed = { message: "m", scores: {}, error: "timed out" };
		expect(view([entry("recognized", failed)], recognizedKind)).toEqual([
			failed,
		]);
	});

	test("reads nothing from a score outside [0, 1] or not a number", () => {
		for (const a of [1.2, -0.1, "0.5"])
			expect(
				view(
					[entry("recognized", { message: "m", scores: { a } })],
					recognizedKind,
				),
			).toEqual([]);
	});
});
