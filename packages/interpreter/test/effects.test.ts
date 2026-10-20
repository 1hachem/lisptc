import { describe, expect, test } from "vitest";
import { Channels } from "../src/channels.ts";
import { bufferTransport } from "../src/channels-host.ts";
import { effect, ends, quiets } from "../src/effects.ts";
import { output } from "../src/topics.ts";

function piped() {
	const channels = new Channels();
	const buffer = bufferTransport();
	channels.pipe(buffer);
	return { channels, buffer };
}

describe("an effect the language raises for the harness", () => {
	test("reaches whoever collects the step, in the order raised", () => {
		const { channels, buffer } = piped();
		effect.emit(channels, { harness: { type: "quiet" } });
		effect.emit(channels, { harness: { type: "end" } });
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
		const { channels, buffer } = piped();
		output.emit(channels, { harness: "for the harness alone" });
		effect.emit(channels, { harness: { type: "quiet" } });
		expect(buffer.collectText("user")).toBe("");
		expect(buffer.collectText("model")).toBe("");
	});
});
