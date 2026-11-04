import { type Entry, entryKind } from "@repo/shared/journal";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { Channels } from "../src/channels.ts";
import { bufferTransport } from "../src/channels-host.ts";
import { journal, record } from "../src/journal.ts";

const noteKind = entryKind({
	name: "note",
	schema: z.object({ text: z.string() }),
});
const viewKind = entryKind({
	name: "view",
	schema: z.object({ viewId: z.string() }),
});

const entry = (kind: string, value: unknown): Entry => ({ kind, value });

describe("recording an entry", () => {
	test("records onto the journal in the order things happen", () => {
		const channels = new Channels();
		const buffer = bufferTransport();
		channels.pipe(buffer);
		record(channels, noteKind, { text: "a" });
		record(channels, viewKind, { viewId: "v1" });
		record(channels, noteKind, { text: "b" });
		expect(buffer.collect(journal)).toEqual([
			entry("note", { text: "a" }),
			entry("view", { viewId: "v1" }),
			entry("note", { text: "b" }),
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
});
