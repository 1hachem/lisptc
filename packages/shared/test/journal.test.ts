import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
	checked,
	ENTRY_TYPE,
	type Entry,
	entriesIn,
	entryKind,
	every,
	latestOnly,
	readReceived,
	view,
} from "../src/journal.ts";

const viewKind = latestOnly({
	name: "ui",
	schema: z.object({ viewId: z.string() }),
});
const doingKind = entryKind({
	name: "intent",
	schema: z.object({ doing: z.string() }),
	fold: every,
});
const doingNow = latestOnly(doingKind);
const askKind = latestOnly({ name: "question", schema: z.string() });

let ids = 0;
const entry = (kind: string, value: unknown): Entry => ({
	id: `e${++ids}`,
	kind,
	value,
});

describe("an entry kind", () => {
	test("may not take a name the message envelope owns", () => {
		expect(() => latestOnly({ name: "display", schema: z.string() })).toThrow(
			/envelope/,
		);
	});

	test("checks a value against its schema before it is recorded", () => {
		expect(checked(viewKind, { viewId: "v1" })).toEqual({ viewId: "v1" });
		expect(() =>
			checked(viewKind, { viewId: 1 } as unknown as { viewId: string }),
		).toThrow(/"ui" entry does not fit/);
	});
});

describe("viewing a journal through a kind", () => {
	const entries = [
		entry("intent", { doing: "a" }),
		entry("memory", { key: "k", body: "b" }),
		entry("intent", "busy"),
		entry("intent", { doing: "b" }),
	];

	test("folds every well-formed value of the kind, in order", () => {
		expect(view(entries, doingKind)).toEqual([{ doing: "a" }, { doing: "b" }]);
	});

	test("lets the kind decide the fold", () => {
		expect(view(entries, doingNow)).toEqual({ doing: "b" });
		expect(view(entries, askKind)).toBeUndefined();
	});

	test("reads nothing from a value of the wrong shape", () => {
		expect(view([entry("ui", "a string")], viewKind)).toBeUndefined();
	});
});

describe("entries stored as messages", () => {
	test("takes the row's id as the entry's, and keeps what it is about", () => {
		expect(
			entriesIn([
				{ type: "human", id: "h", additional_kwargs: { kind: "ui" } },
				{
					type: ENTRY_TYPE,
					id: "r1",
					additional_kwargs: {
						kind: "ui",
						value: { viewId: "v" },
						about: "s1",
					},
				},
				{ type: ENTRY_TYPE, id: "r2", additional_kwargs: { value: 1 } },
			]),
		).toEqual([{ id: "r1", kind: "ui", value: { viewId: "v" }, about: "s1" }]);
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
