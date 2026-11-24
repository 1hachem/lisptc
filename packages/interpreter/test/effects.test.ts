import { describe, expect, test } from "vitest";
import { effect } from "../src/effects.ts";
import { bufferSink, Journal } from "../src/journal.ts";

function piped() {
	const journal = new Journal();
	const buffer = bufferSink();
	journal.pipe(buffer);
	return { journal, buffer };
}

describe("an effect the language raises for the harness", () => {
	test("never reaches the text the user or the model reads", () => {
		const { journal, buffer } = piped();
		journal.write(effect, { type: "quiet" });
		expect(buffer.collectText("user")).toBe("");
		expect(buffer.collectText("model")).toBe("");
	});
});
