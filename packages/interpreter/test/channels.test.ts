import { describe, expect, it } from "vitest";
import { Channels, type Envelope, topic } from "../src/channels.ts";
import { bufferTransport } from "../src/channels-host.ts";
import { proseExtension } from "../src/extensions/prose/prose.ts";
import { Interp, runSync, str } from "../src/lisp.ts";
import { note, output } from "../src/topics.ts";

const weather = topic<{ sky: string }>("weather");

function record(channels: Channels, name: string): Envelope[] {
	const seen: Envelope[] = [];
	channels.on(name, (e) => seen.push(e));
	return seen;
}

describe("Channels", () => {
	it("delivers only to the topic emitted on", () => {
		const channels = new Channels();
		const printed = record(channels, output.name);
		const noted = record(channels, note.name);
		output.emit(channels, { user: "printed" });
		expect(printed.map((e) => e.payload)).toEqual(["printed"]);
		expect(noted).toEqual([]);
	});

	it("delivers every envelope to an onAny subscriber", () => {
		const channels = new Channels();
		const everything: Envelope[] = [];
		channels.onAny((e) => everything.push(e));
		output.emit(channels, { user: "printed" });
		weather.emit(channels, { model: { sky: "clear" } });
		expect(everything.map((e) => e.topic)).toEqual([output.name, "weather"]);
	});

	it("carries a topic the core never heard of", () => {
		const channels = new Channels();
		const seen: { sky: string }[] = [];
		weather.on(channels, (payload) => seen.push(payload));
		weather.emit(channels, { model: { sky: "clear" } });
		expect(seen).toEqual([{ sky: "clear" }]);
	});

	it("stamps the channels' current step onto what it sends", () => {
		const channels = new Channels();
		const seen = record(channels, output.name);
		output.emit(channels, { user: "first" });
		channels.step = 7;
		output.emit(channels, { user: "second" });
		expect(seen.map((e) => e.step)).toEqual([0, 7]);
	});

	it("stops delivering after unsubscribe", () => {
		const channels = new Channels();
		const seen: string[] = [];
		const off = output.on(channels, (text) => seen.push(text));
		output.emit(channels, { user: "first" });
		off();
		output.emit(channels, { user: "second" });
		expect(seen).toEqual(["first"]);
	});

	it("survives a listener that throws, and still reaches the others", () => {
		const channels = new Channels();
		output.on(channels, () => {
			throw new Error("subscriber is broken");
		});
		const seen = record(channels, output.name);
		expect(() => output.emit(channels, { user: "printed" })).not.toThrow();
		expect(seen).toHaveLength(1);
	});

	it("reports a broken listener as a failed note instead of swallowing it", () => {
		const channels = new Channels();
		const notes: string[] = [];
		note.on(channels, (n) => notes.push(`${n.kind}: ${n.text}`));
		output.on(channels, () => {
			throw new Error("subscriber is broken");
		});
		output.emit(channels, { user: "printed" });
		expect(notes).toEqual([
			"failed: a listener on output threw: subscriber is broken",
		]);
	});
});

describe("a piped transport", () => {
	it("receives every envelope until it is detached", () => {
		const channels = new Channels();
		const buffer = bufferTransport();
		const detach = channels.pipe(buffer);
		output.emit(channels, { user: "first" });
		detach();
		output.emit(channels, { user: "second" });
		expect(buffer.text("user")).toBe("first");
	});

	it("is dropped once it reports itself closed", () => {
		const channels = new Channels();
		const sent: string[] = [];
		channels.pipe({
			send(e) {
				sent.push(String(e.payload));
				return sent.length < 2;
			},
		});
		output.emit(channels, { user: "while open" });
		output.emit(channels, { user: "the last one it accepts" });
		output.emit(channels, { user: "never seen" });
		expect(sent).toEqual(["while open", "the last one it accepts"]);
	});

	it("sorts what it collected by audience and by topic", () => {
		const channels = new Channels();
		const buffer = bufferTransport();
		channels.pipe(buffer);
		output.emit(channels, { user: "for the person" });
		output.emit(channels, { model: "for the model" });
		output.emit(channels, { user: " for both", model: " for both" });
		weather.emit(channels, { model: { sky: "clear" } });
		expect(buffer.text("user")).toBe("for the person for both");
		expect(buffer.text("model")).toBe("for the model for both");
		expect(buffer.payloads(weather)).toEqual([{ sky: "clear" }]);
	});
});

describe("an interp's channels", () => {
	it("puts printed output on the user's side and not the model's", () => {
		const interp = new Interp();
		const buffer = bufferTransport();
		interp.channels.pipe(buffer);
		runSync(interp, '(echo "hello")');
		expect(buffer.text("user")).toBe("hello\n");
		expect(buffer.text("model")).toBe("");
	});

	it("keeps one interp's output out of another's", () => {
		const first = new Interp();
		const second = new Interp();
		const buffer = bufferTransport();
		first.channels.pipe(buffer);
		runSync(second, '(echo "not yours")');
		expect(buffer.envelopes).toEqual([]);
	});

	it("notes a skipped aside for the model alone", () => {
		const interp = new Interp({ extensions: [proseExtension()] });
		const buffer = bufferTransport();
		interp.channels.pipe(buffer);
		expect(str(runSync(interp, "an aside (see below)\n(+ 1 2)"))).toBe("3");
		expect(buffer.payloads(note).map((n) => n.kind)).toEqual(["skipped"]);
		expect(buffer.payloads(note)[0]?.text).toContain("(see below)");
		expect(buffer.envelopes.every((e) => !e.to.includes("user"))).toBe(true);
	});

	it("notes a failing top-level form, and the note reaches a subscriber", () => {
		const interp = new Interp();
		const failed: string[] = [];
		note.on(interp.channels, (n) => {
			if (n.kind === "failed") failed.push(n.text);
		});
		expect(() => runSync(interp, "(car 1 2 3)")).toThrow();
		expect(failed).toHaveLength(1);
		expect(failed[0]).toContain("EvalException");
	});
});
