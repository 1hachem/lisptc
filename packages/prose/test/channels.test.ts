import { bufferTransport } from "@repo/interpreter/channels-host";
import { runSync, str } from "@repo/interpreter/lisp";
import { note } from "@repo/interpreter/topics";
import { describe, expect, it } from "vitest";
import { proseInterp } from "./helpers.ts";

describe("prose channel notes", () => {
	it("notes a skipped aside for the model alone", () => {
		const interp = proseInterp();
		const buffer = bufferTransport();
		interp.channels.pipe(buffer);
		expect(str(runSync(interp, "an aside (see below)\n(+ 1 2)"))).toBe("3");
		expect(buffer.collect(note).map((entry) => entry.kind)).toEqual([
			"skipped",
		]);
		expect(buffer.collect(note)[0]?.text).toContain("(see below)");
		expect(buffer.envelopes.every((entry) => !entry.to.includes("user"))).toBe(
			true,
		);
	});
});
