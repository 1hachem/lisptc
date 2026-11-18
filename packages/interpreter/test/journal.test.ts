import { describe, expect, it, test } from "vitest";
import { bufferSink, hitch, print, printed } from "../src/journal.ts";
import { Interp, runSync } from "../src/lisp.ts";
import { evWithOutput } from "./helpers.ts";

describe("writing an entry", () => {
	test("journals entries in the order things happen", () => {
		const { output } = evWithOutput('(echo "a") (echo "b") (echo "c")');
		expect(output).toBe("a\nb\nc\n");
	});

	test("prints nothing without a journal", () => {
		expect(() => print(undefined, { user: "nowhere" })).not.toThrow();
	});
});

describe("listening to the journal", () => {
	it("survives a listener that throws, and the text still reaches the user", () => {
		const interp = new Interp();
		interp.journal.on(printed, () => {
			throw new Error("listener is broken");
		});
		expect(evWithOutput('(echo "printed") 1', interp)).toEqual({
			value: "1",
			output: "printed\n",
		});
	});

	it("reports a broken listener as a failed hitch instead of swallowing it", () => {
		const interp = new Interp();
		interp.journal.on(printed, () => {
			throw new Error("listener is broken");
		});
		const buffer = bufferSink();
		interp.journal.pipe(buffer);
		runSync(interp, '(echo "printed")');
		expect(buffer.collect(hitch).map((h) => h.kind)).toEqual(["failed"]);
	});
});

describe("a piped sink", () => {
	it("receives every entry until it is detached", () => {
		const interp = new Interp();
		const buffer = bufferSink();
		const detach = interp.journal.pipe(buffer);
		runSync(interp, '(echo "first")');
		detach();
		runSync(interp, '(echo "second")');
		expect(buffer.collectText("user")).toBe("first\n");
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
		expect(buffer.collectText("user")).toBe("");
	});
});
