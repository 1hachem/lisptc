import { describe, expect, test } from "vitest";
import { z } from "zod";
import { answering, asksKind, asksOf, unansweredAsks } from "../src/asks.ts";
import { Channels } from "../src/channels.ts";
import { bufferTransport } from "../src/channels-host.ts";
import {
	activityKind,
	activityOf,
	type Entry,
	entriesOf,
	entryKind,
	intentKind,
	journal,
	latest,
	memoryKind,
	questionKind,
	readEntry,
	readReceived,
	record,
	viewKind,
} from "../src/journal.ts";

const entry = (kind: string, value: unknown): Entry => ({ kind, value });

describe("an entry kind", () => {
	test("records onto the journal in the order things happen", () => {
		const channels = new Channels();
		const buffer = bufferTransport();
		channels.pipe(buffer);
		record(channels, memoryKind, { key: "a", body: "x" });
		record(channels, viewKind, { viewId: "v1" });
		record(channels, memoryKind, { key: "b", body: "y" });
		expect(buffer.collect(journal)).toEqual([
			entry("memory", { key: "a", body: "x" }),
			entry("ui", { viewId: "v1" }),
			entry("memory", { key: "b", body: "y" }),
		]);
	});

	test("records to the harness alone", () => {
		const channels = new Channels();
		const buffer = bufferTransport();
		channels.pipe(buffer);
		record(channels, viewKind, { viewId: "v1" });
		expect(buffer.envelopes.map((e) => e.to)).toEqual([["harness"]]);
		expect(buffer.collectText("user")).toBe("");
		expect(buffer.collectText("model")).toBe("");
	});

	test("records nothing without channels", () => {
		expect(() => record(undefined, viewKind, { viewId: "v1" })).not.toThrow();
	});

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
		expect(readEntry(entry("memory", { key: "" }), memoryKind)).toBeUndefined();
		expect(readEntry(entry("asks", 3), asksKind)).toBeUndefined();
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
		expect(entriesOf(entries, intentKind)).toEqual([
			{ doing: "a" },
			{ doing: "b" },
		]);
	});

	test("takes the latest well-formed value of a kind", () => {
		expect(latest(entries, intentKind)).toEqual({ doing: "b" });
		expect(latest(entries, questionKind)).toBeUndefined();
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

describe("intent and question kinds", () => {
	const intent = (value: unknown) =>
		readEntry(entry("intent", value), intentKind);

	test("read back an intent and a question of the right shape", () => {
		const doing = { doing: "d", todos: [{ label: "a", done: true }] };
		const question = { id: "q1", prompt: "p", choices: ["A"], multi: false };
		expect(intent(doing)).toEqual(doing);
		expect(readEntry(entry("question", question), questionKind)).toEqual(
			question,
		);
	});

	test("read nothing from an intent of the wrong shape", () => {
		expect(intent("busy")).toBeUndefined();
		expect(intent({ todos: [{ label: "a" }] })).toBeUndefined();
		expect(intent({ doing: 3 })).toBeUndefined();
	});

	test("read back an intent with progress, label optional", () => {
		const bare = { progress: { done: 0, total: 3 } };
		const labelled = { progress: { done: 3, total: 3, label: "files" } };
		expect(intent(bare)).toEqual(bare);
		expect(intent(labelled)).toEqual(labelled);
	});

	test("read nothing from an intent whose progress is out of range", () => {
		for (const progress of [
			{ done: 4, total: 3 },
			{ done: 0, total: 0 },
			{ done: -1, total: 3 },
			{ done: 1.5, total: 3 },
			{ done: 1, total: 3, label: 7 },
		])
			expect(intent({ progress })).toBeUndefined();
	});

	test("read back an intent with the log of its doing lines", () => {
		const logged = {
			doing: "b",
			log: [
				{ text: "a", startedAt: 1000, ms: 250, state: "done" },
				{ text: "b", startedAt: 1250, state: "running" },
			],
		};
		expect(intent(logged)).toEqual(logged);
	});

	test("read nothing from an intent whose log is malformed", () => {
		for (const step of [
			{ text: "a", startedAt: 1000, state: "started" },
			{ text: "a", state: "running" },
			{ text: 3, startedAt: 1000, state: "running" },
			{ text: "a", startedAt: 1000, ms: "1s", state: "done" },
		])
			expect(intent({ log: [step] })).toBeUndefined();
	});

	test("read nothing from a question of the wrong shape", () => {
		const question = { id: "q1", prompt: "p", choices: ["A"], multi: false };
		const read = (value: unknown) =>
			readEntry(entry("question", value), questionKind);
		expect(read({ ...question, choices: [] })).toBeUndefined();
		expect(read({ ...question, multi: "no" })).toBeUndefined();
		expect(read({ prompt: "p" })).toBeUndefined();
	});
});

describe("asks read off the journal", () => {
	const open = [{ id: "a1", title: "t", prompt: "p", choices: [] }];

	test("are unanswered until an answer for their id is recorded", () => {
		const asked = [entry("asks", { open })];
		expect(unansweredAsks(asksOf(asked)).map((a) => a.id)).toEqual(["a1"]);
		const answered = [
			...asked,
			entry("asks", answering("a1", { accepted: true, label: "ok" })),
		];
		expect(unansweredAsks(asksOf(answered))).toEqual([]);
	});

	test("gather what several entries ask and answer", () => {
		expect(
			asksOf([
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
		expect(asksOf([])).toEqual({});
		expect(asksOf([entry("intent", { doing: "a" })])).toEqual({});
	});

	test("skip an entry whose answer is not an answer", () => {
		expect(
			asksOf([entry("asks", { open, answered: { a1: { accepted: "yes" } } })]),
		).toEqual({});
	});
});

describe("activityOf", () => {
	const started = (id: string, label = id) => ({
		kind: "mcp",
		label,
		state: "started" as const,
		id,
	});
	const of = (...values: unknown[]) =>
		activityOf(values.map((value) => entry("activity", value)));

	test("keeps each id once, in the order it first appeared", () => {
		expect(of(started("a"), started("b")).map((e) => e.id)).toEqual(["a", "b"]);
	});

	test("lets a later state of the same id replace its started in place", () => {
		expect(
			of(started("a"), started("b"), {
				...started("a"),
				state: "done",
				detail: "d",
			}),
		).toEqual([
			{ kind: "mcp", label: "a", state: "done", detail: "d", id: "a" },
			started("b"),
		]);
	});

	test("keeps the start time of a started entry when its end carries only the duration", () => {
		expect(
			of(
				{ ...started("a"), startedAt: 1000 },
				{ ...started("a"), state: "failed", ms: 40 },
			),
		).toEqual([{ ...started("a"), state: "failed", startedAt: 1000, ms: 40 }]);
	});

	test("skips a malformed entry and an entry of another kind", () => {
		expect(
			activityOf([
				entry("activity", { ...started("a"), state: "x" }),
				entry("memory", started("b")),
			]),
		).toEqual([]);
		expect(readEntry(entry("activity", started("a")), activityKind)).toEqual(
			started("a"),
		);
	});
});
