import { describe, expect, it } from "vitest";
import {
	ALL,
	Channels,
	type Diagnostic,
	MODEL,
	USER,
} from "../src/channels.ts";
import { Interp, run, setWriter, str } from "../src/lisp.ts";
import { proseExtension } from "../src/prose.ts";

function record(channels: Channels, channel: string): Diagnostic[] {
	const seen: Diagnostic[] = [];
	channels.on(channel, (d) => seen.push(d));
	return seen;
}

describe("Channels", () => {
	it("delivers only to the channel emitted on", () => {
		const channels = new Channels();
		const user = record(channels, USER);
		const model = record(channels, MODEL);
		channels.emit({ channel: USER, text: "printed" });
		expect(user.map((d) => d.text)).toEqual(["printed"]);
		expect(model).toEqual([]);
	});

	// A debug view wants everything without every emitter having to double-post
	// to be visible.
	it("delivers every record to an ALL subscriber", () => {
		const channels = new Channels();
		const everything = record(channels, ALL);
		channels.emit({ channel: USER, text: "printed" });
		channels.emit({ channel: "compaction", text: "fold the transcript" });
		expect(everything.map((d) => d.channel)).toEqual([USER, "compaction"]);
	});

	// A channel is not registered, only emitted on — which is what makes a new
	// one (context compression, say) cost nothing in the core.
	it("carries a channel the core never heard of", () => {
		const channels = new Channels();
		const seen = record(channels, "compaction");
		channels.emit({ channel: "compaction", text: "fold the transcript" });
		expect(seen).toHaveLength(1);
	});

	it("stops delivering after unsubscribe", () => {
		const channels = new Channels();
		const seen: string[] = [];
		const off = channels.on(USER, (d) => seen.push(d.text));
		channels.emit({ channel: USER, text: "first" });
		off();
		channels.emit({ channel: USER, text: "second" });
		expect(seen).toEqual(["first"]);
	});

	// Reporting must never change the outcome of the program that reported.
	it("survives a listener that throws, and still reaches the others", () => {
		const channels = new Channels();
		channels.on(USER, () => {
			throw new Error("subscriber is broken");
		});
		const seen = record(channels, USER);
		expect(() =>
			channels.emit({ channel: USER, text: "printed" }),
		).not.toThrow();
		expect(seen).toHaveLength(1);
	});
});

describe("an interp's channels", () => {
	it("puts printed output on the user channel", () => {
		const interp = new Interp();
		const user = record(interp.channels, USER);
		run(interp, '(princ "hello") (terpri)');
		expect(user.map((d) => d.text)).toEqual(["hello", "\n"]);
		expect(user.every((d) => d.severity === undefined)).toBe(true);
	});

	// Two interps in one process no longer share one sink: this is what the
	// module-level writer could not express.
	it("keeps one interp's output out of another's", () => {
		const first = new Interp();
		const second = new Interp();
		const seen = record(first.channels, USER);
		run(second, '(princ "not yours")');
		expect(seen).toEqual([]);
	});

	// The process-wide writer stays the default sink, so a host that never
	// learns about channels keeps working.
	it("still feeds setWriter", () => {
		let out = "";
		const prev = setWriter((s) => {
			out += s;
		});
		try {
			run(new Interp(), '(princ "via the writer")');
		} finally {
			setWriter(prev);
		}
		expect(out).toBe("via the writer");
	});

	// Severity is the axis that separates a program that ran anyway from one
	// that did not — both are addressed to the model.
	it("reports a skip as a warning and a failure as critical", () => {
		const interp = new Interp({ extensions: [proseExtension()] });
		const model = record(interp.channels, MODEL);
		expect(str(run(interp, "an aside (see below)\n(+ 1 2)"))).toBe("3");
		expect(model.map((d) => d.severity)).toEqual(["warning"]);

		expect(() => run(interp, "(car 1 2 3)")).toThrow();
		expect(model.at(-1)?.severity).toBe("critical");
	});
});
