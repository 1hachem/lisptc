import { entryKind, every } from "@repo/shared/journal";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { Channels } from "../src/channels.ts";
import { bufferTransport } from "../src/channels-host.ts";
import { journal, record } from "../src/journal.ts";

const noteKind = entryKind({
	name: "note",
	schema: z.object({ text: z.string() }),
	fold: every,
});
const viewKind = entryKind({
	name: "view",
	schema: z.object({ viewId: z.string() }),
	fold: every,
});

describe("recording an entry", () => {
	test("records onto the journal in the order things happen", () => {
		const channels = new Channels();
		const buffer = bufferTransport();
		channels.pipe(buffer);
		record(channels, noteKind, { text: "a" });
		record(channels, viewKind, { viewId: "v1" });
		record(channels, noteKind, { text: "b" });
		expect(
			buffer.collect(journal).map(({ kind, value }) => ({ kind, value })),
		).toEqual([
			{ kind: "note", value: { text: "a" } },
			{ kind: "view", value: { viewId: "v1" } },
			{ kind: "note", value: { text: "b" } },
		]);
	});

	test("gives every entry on a channel an id of its own, under the step it was recorded in", () => {
		const channels = new Channels();
		const buffer = bufferTransport();
		channels.pipe(buffer);
		channels.step = 3;
		record(channels, noteKind, { text: "a" });
		record(channels, noteKind, { text: "b" });
		channels.step = 4;
		record(channels, noteKind, { text: "c" });
		expect(buffer.collect(journal).map((e) => e.id)).toEqual([
			"3.1",
			"3.2",
			"4.3",
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

	test("refuses a value its kind would not read back, at the one who records it", () => {
		const channels = new Channels();
		const buffer = bufferTransport();
		channels.pipe(buffer);
		expect(() =>
			record(channels, viewKind, { viewId: 1 } as unknown as {
				viewId: string;
			}),
		).toThrow(/"view" entry does not fit/);
		expect(buffer.collect(journal)).toEqual([]);
	});

	test("stamps an entry with the channel clock when its kind asks for the time", () => {
		const stampedKind = entryKind({
			name: "stamped",
			schema: z.object({ text: z.string(), at: z.number().optional() }),
			stamp: (value, at) => ({ ...value, at }),
			fold: every,
		});
		const channels = new Channels();
		channels.clock = { now: () => 1234 };
		const buffer = bufferTransport();
		channels.pipe(buffer);
		record(channels, stampedKind, { text: "a" });
		record(channels, noteKind, { text: "b" });
		expect(buffer.collect(journal).map(({ value }) => value)).toEqual([
			{ text: "a", at: 1234 },
			{ text: "b" },
		]);
	});
});
