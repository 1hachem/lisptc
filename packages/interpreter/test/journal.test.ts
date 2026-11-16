import { type Entry, entryKind, every } from "@repo/shared/journal";
import { describe, expect, it, test } from "vitest";
import { z } from "zod";
import { bufferSink, hitch, Journal, print, printed } from "../src/journal.ts";
import { Interp, runSync } from "../src/lisp.ts";

const remark = entryKind({
	name: "remark",
	schema: z.object({ text: z.string() }),
	fold: every,
});
const viewKind = entryKind({
	name: "view",
	schema: z.object({ viewId: z.string() }),
	fold: every,
});

function piped() {
	const journal = new Journal();
	const buffer = bufferSink();
	journal.pipe(buffer);
	return { journal, buffer };
}

describe("writing an entry", () => {
	test("journals entries in the order things happen", () => {
		const { journal, buffer } = piped();
		journal.write(remark, { text: "a" });
		journal.write(viewKind, { viewId: "v1" });
		journal.write(remark, { text: "b" });
		expect(buffer.entries.map(({ kind, value }) => ({ kind, value }))).toEqual([
			{ kind: "remark", value: { text: "a" } },
			{ kind: "view", value: { viewId: "v1" } },
			{ kind: "remark", value: { text: "b" } },
		]);
	});

	test("gives every entry an id of its own, under the evaluation it was written in", () => {
		const { journal, buffer } = piped();
		journal.evaluation = 3;
		journal.write(remark, { text: "a" });
		print(journal, { user: "b" });
		journal.evaluation = 4;
		journal.write(remark, { text: "c" });
		expect(buffer.entries.map((e) => e.id)).toEqual(["3.1", "3.2", "4.3"]);
	});

	test("refuses a value its kind would not read back, at the one who writes it", () => {
		const { journal, buffer } = piped();
		expect(() =>
			journal.write(viewKind, { viewId: 1 } as unknown as { viewId: string }),
		).toThrow(/"view" entry does not fit/);
		expect(buffer.entries).toEqual([]);
	});

	test("prints nothing without a journal", () => {
		expect(() => print(undefined, { user: "nowhere" })).not.toThrow();
	});
});

describe("listening to the journal", () => {
	it("calls a listener only for the kind it listens to", () => {
		const journal = new Journal();
		const remarks: string[] = [];
		journal.on(remark, (value) => remarks.push(value.text));
		print(journal, { user: "printed" });
		journal.write(remark, { text: "said" });
		expect(remarks).toEqual(["said"]);
	});

	it("calls an onAny listener for every entry until it unsubscribes", () => {
		const journal = new Journal();
		const kinds: string[] = [];
		const off = journal.onAny((e) => kinds.push(e.kind));
		print(journal, { user: "first" });
		journal.write(remark, { text: "said" });
		off();
		print(journal, { user: "second" });
		expect(kinds).toEqual(["printed", "remark"]);
	});

	it("stops calling a listener once it unsubscribes", () => {
		const journal = new Journal();
		const seen: string[] = [];
		const off = journal.on(printed, (p) => seen.push(p.text));
		print(journal, { user: "first" });
		off();
		print(journal, { user: "second" });
		expect(seen).toEqual(["first"]);
	});

	it("survives a listener that throws, and still reaches the others", () => {
		const journal = new Journal();
		journal.on(printed, () => {
			throw new Error("listener is broken");
		});
		const seen: Entry[] = [];
		journal.on(printed, (_, e) => seen.push(e));
		expect(() => print(journal, { user: "printed" })).not.toThrow();
		expect(seen).toHaveLength(1);
	});

	it("reports a broken listener as a failed hitch instead of swallowing it", () => {
		const journal = new Journal();
		const hitches: string[] = [];
		journal.on(hitch, (n) => hitches.push(`${n.kind}: ${n.text}`));
		journal.on(printed, () => {
			throw new Error("listener is broken");
		});
		print(journal, { user: "printed" });
		expect(hitches).toEqual([
			"failed: a listener on printed threw: listener is broken",
		]);
	});

	it("reports a listener that throws something other than an error", () => {
		const journal = new Journal();
		const hitches: string[] = [];
		journal.on(hitch, (n) => hitches.push(n.text));
		journal.on(printed, () => {
			throw "not an error";
		});
		print(journal, { user: "printed" });
		expect(hitches).toEqual(["a listener on printed threw: not an error"]);
	});
});

describe("a piped sink", () => {
	it("receives every entry until it is detached", () => {
		const journal = new Journal();
		const buffer = bufferSink();
		const detach = journal.pipe(buffer);
		print(journal, { user: "first" });
		detach();
		print(journal, { user: "second" });
		expect(buffer.collectText("user")).toBe("first");
	});

	it("is dropped once it reports itself closed", () => {
		const journal = new Journal();
		const sent: string[] = [];
		journal.pipe({
			send(e) {
				sent.push((e.value as { text: string }).text);
				return sent.length < 2;
			},
		});
		print(journal, { user: "while open" });
		print(journal, { user: "the last one it accepts" });
		print(journal, { user: "never seen" });
		expect(sent).toEqual(["while open", "the last one it accepts"]);
	});

	it("is dropped once it throws on send", () => {
		const journal = new Journal();
		let tries = 0;
		journal.pipe({
			send() {
				tries++;
				throw new Error("sink is broken");
			},
		});
		print(journal, { user: "first" });
		print(journal, { user: "second" });
		expect(tries).toBe(1);
	});

	it("is closed when detached, and only the first time", () => {
		const journal = new Journal();
		let closed = 0;
		const detach = journal.pipe({
			send: () => true,
			close() {
				closed++;
			},
		});
		detach();
		detach();
		expect(closed).toBe(1);
	});

	it("sorts what was printed by reader, and the rest by kind", () => {
		const { journal, buffer } = piped();
		print(journal, { user: "for the person" });
		print(journal, { model: "for the model" });
		print(journal, { user: " for both", model: " for both" });
		journal.write(remark, { text: "said" });
		expect(buffer.collectText("user")).toBe("for the person for both");
		expect(buffer.collectText("model")).toBe("for the model for both");
		expect(buffer.collect(remark)).toEqual([{ text: "said" }]);
	});

	it("keeps text that differs between readers apart", () => {
		const { journal, buffer } = piped();
		print(journal, { user: "short", model: "long" });
		expect(buffer.collectText("user")).toBe("short");
		expect(buffer.collectText("model")).toBe("long");
	});
});

describe("an interp's journal", () => {
	it("puts echoed text on the user's side and not the model's", () => {
		const interp = new Interp();
		const buffer = bufferSink();
		interp.journal.pipe(buffer);
		runSync(interp, '(echo "hello")');
		expect(buffer.collectText("user")).toBe("hello\n");
		expect(buffer.collectText("model")).toBe("");
	});

	it("keeps one interp's entries out of another's", () => {
		const first = new Interp();
		const second = new Interp();
		const buffer = bufferSink();
		first.journal.pipe(buffer);
		runSync(second, '(echo "not yours")');
		expect(buffer.entries).toEqual([]);
	});

	it("reports a failing top-level form as a hitch that reaches a listener", () => {
		const interp = new Interp();
		const failed: string[] = [];
		interp.journal.on(hitch, (n) => {
			if (n.kind === "failed") failed.push(n.text);
		});
		expect(() => runSync(interp, "(car 1 2 3)")).toThrow();
		expect(failed).toHaveLength(1);
		expect(failed[0]).toContain("EvalException");
	});
});
