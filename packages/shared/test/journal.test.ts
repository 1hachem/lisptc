import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
	type Entry,
	entriesOf,
	entryKind,
	latest,
	readEntry,
	readReceived,
} from "../src/journal.ts";

const viewKind = entryKind({
	name: "ui",
	schema: z.object({ viewId: z.string() }),
});
const doingKind = entryKind({
	name: "intent",
	schema: z.object({ doing: z.string() }),
});
const askKind = entryKind({ name: "question", schema: z.string() });

const entry = (kind: string, value: unknown): Entry => ({ kind, value });

describe("an entry kind", () => {
	test("may not take a name the message envelope owns", () => {
		expect(() => entryKind({ name: "display", schema: z.string() })).toThrow(
			/envelope/,
		);
	});

	test("reads a value only from an entry of its own kind", () => {
		expect(readEntry(entry("ui", { viewId: "v1" }), viewKind)).toEqual({
			viewId: "v1",
		});
		expect(
			readEntry(entry("intent", { viewId: "v1" }), viewKind),
		).toBeUndefined();
	});

	test("reads nothing from a value of the wrong shape", () => {
		expect(readEntry(entry("ui", "a string"), viewKind)).toBeUndefined();
		expect(
			readEntry(
				entry("ui", { tag: "card", props: {}, children: [] }),
				viewKind,
			),
		).toBeUndefined();
	});
});

describe("reading a journal", () => {
	const entries = [
		entry("intent", { doing: "a" }),
		entry("memory", { key: "k", body: "b" }),
		entry("intent", "busy"),
		entry("intent", { doing: "b" }),
	];

	test("keeps every well-formed value of a kind, in order", () => {
		expect(entriesOf(entries, doingKind)).toEqual([
			{ doing: "a" },
			{ doing: "b" },
		]);
	});

	test("takes the latest well-formed value of a kind", () => {
		expect(latest(entries, doingKind)).toEqual({ doing: "b" });
		expect(latest(entries, askKind)).toBeUndefined();
	});
});

describe("what the user sends beside a message", () => {
	test("reads a value of the right shape under the kind's name", () => {
		expect(readReceived({ ui: { viewId: "v1" } }, viewKind)).toEqual({
			viewId: "v1",
		});
		expect(readReceived({ ui: "v1" }, viewKind)).toBeUndefined();
		expect(readReceived(undefined, viewKind)).toBeUndefined();
	});
});
