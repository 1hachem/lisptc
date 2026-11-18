import { bufferSink, hitch } from "@repo/interpreter/journal";
import { runSync } from "@repo/interpreter/lisp";
import { str } from "@repo/interpreter/print";
import { describe, expect, it } from "vitest";
import { proseInterp } from "./helpers.ts";

describe("prose channel notes", () => {
	it("notes a skipped aside for the model alone", () => {
		const interp = proseInterp();
		const buffer = bufferSink();
		interp.journal.pipe(buffer);
		expect(str(runSync(interp, "an aside (see below)\n(+ 1 2)"))).toBe("3");
		expect(buffer.collect(hitch).map((entry) => entry.kind)).toEqual([
			"skipped",
		]);
		expect(buffer.collect(hitch)[0]?.text).toContain("(see below)");
		expect(buffer.collectText("user")).toBe("");
	});
});
