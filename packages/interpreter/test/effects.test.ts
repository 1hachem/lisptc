import { describe, expect, test } from "vitest";
import { effect, ends, quiets } from "../src/effects.ts";
import { bufferSink, Journal } from "../src/journal.ts";

function piped() {
	const journal = new Journal();
	const buffer = bufferSink();
	journal.pipe(buffer);
	return { journal, buffer };
}

describe("an effect the language raises for the harness", () => {
	test("reaches whoever collects the step, in the order raised", () => {
		const { journal, buffer } = piped();
		journal.write(effect, { type: "quiet" });
		journal.write(effect, { type: "end" });
		expect(buffer.collect(effect)).toEqual([
			{ type: "quiet" },
			{ type: "end" },
		]);
	});

	test("is read for what it asks of the turn", () => {
		expect(ends([{ type: "end" }])).toBe(true);
		expect(ends([{ type: "quiet" }])).toBe(false);
		expect(quiets([{ type: "end" }, { type: "quiet" }])).toBe(true);
		expect(quiets([])).toBe(false);
	});

	test("never reaches the text the user or the model reads", () => {
		const { journal, buffer } = piped();
		journal.write(effect, { type: "quiet" });
		expect(buffer.collectText("user")).toBe("");
		expect(buffer.collectText("model")).toBe("");
	});
});
