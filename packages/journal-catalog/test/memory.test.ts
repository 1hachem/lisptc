import { type Entry, view } from "@repo/shared/journal";
import { describe, expect, test } from "vitest";
import { memoryKind } from "../src/memory.ts";

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
