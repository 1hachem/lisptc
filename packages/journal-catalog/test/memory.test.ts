import { type Entry, readEntry } from "@repo/shared/journal";
import { describe, expect, test } from "vitest";
import { memoryKind } from "../src/memory.ts";

const entry = (kind: string, value: unknown): Entry => ({ kind, value });

describe("a fired memory", () => {
	test("reads back a memory with a key", () => {
		expect(
			readEntry(entry("memory", { key: "a", body: "x" }), memoryKind),
		).toEqual({ key: "a", body: "x" });
	});

	test("reads nothing from a memory without a key", () => {
		expect(readEntry(entry("memory", { key: "" }), memoryKind)).toBeUndefined();
	});
});
