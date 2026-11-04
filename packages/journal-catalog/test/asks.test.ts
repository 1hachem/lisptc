import { type Entry, view } from "@repo/shared/journal";
import { describe, expect, test } from "vitest";
import { answering, asksKind, unansweredAsks } from "../src/asks.ts";

const foldAsks = (entries: readonly Entry[]) => view(entries, asksKind);

let ids = 0;
const entry = (kind: string, value: unknown): Entry => ({
	id: `e${++ids}`,
	kind,
	value,
});

describe("asks read off the journal", () => {
	test("read nothing from a value of the wrong shape", () => {
		expect(view([entry("asks", 3)], asksKind)).toEqual({});
	});

	const open = [{ id: "a1", title: "t", prompt: "p", choices: [] }];

	test("are unanswered until an answer for their id is recorded", () => {
		const asked = [entry("asks", { open })];
		expect(unansweredAsks(foldAsks(asked)).map((a) => a.id)).toEqual(["a1"]);
		const answered = [
			...asked,
			entry("asks", answering("a1", { accepted: true, label: "ok" })),
		];
		expect(unansweredAsks(foldAsks(answered))).toEqual([]);
	});

	test("gather what several entries ask and answer", () => {
		expect(
			foldAsks([
				entry("asks", { open }),
				entry("asks", { answered: { c: { accepted: false, label: "No" } } }),
				entry("asks", { open: [{ ...open[0], id: "a2" }] }),
			]),
		).toEqual({
			open: [
				{ ...open[0], choices: [] },
				{ ...open[0], id: "a2", choices: [] },
			],
			answered: { c: { accepted: false, label: "No" } },
		});
	});

	test("are empty when nothing was asked", () => {
		expect(foldAsks([])).toEqual({});
		expect(foldAsks([entry("intent", { doing: "a" })])).toEqual({});
	});

	test("skip an entry whose answer is not an answer", () => {
		expect(
			foldAsks([
				entry("asks", { open, answered: { a1: { accepted: "yes" } } }),
			]),
		).toEqual({});
	});
});
