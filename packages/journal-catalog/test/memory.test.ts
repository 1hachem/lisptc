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
	test("reads nothing from a memory without a key", () => {
		expect(view([entry("memory", { key: "" })], memoryKind)).toEqual([]);
	});
});
