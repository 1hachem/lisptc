import { Interp, prelude, runSync } from "@repo/interpreter/lisp";
import { proseExtension } from "@repo/prose-extension";
import { describe, expect, test } from "vitest";
import { Checks } from "@repo/checks/checks";
import { Trace } from "@repo/checks/trace";

function ran(code: string): Trace {
	const trace = new Trace();
	const interp = new Interp({
		extensions: [proseExtension(), trace.extension()],
	});
	runSync(interp, prelude);
	trace.beginStep(1);
	try {
		runSync(interp, code);
	} catch {}
	return trace;
}

function verdict(trace: Trace, source: string): string {
	const checks = new Checks(trace, source);
	checks.evaluate(1);
	return checks.results()[0]?.verdict ?? "missing";
}

describe("what the interpreter's notes become in a trace", () => {
	test("a skipped aside is a warning the (skipped) positions can see", () => {
		const trace = ran("an aside (see below)\n(+ 1 2)");
		expect(trace.events.filter((e) => e.kind === "note")).toEqual([
			{
				kind: "note",
				step: 1,
				severity: "warning",
				text: expect.stringContaining("(see below)"),
			},
		]);
		expect(verdict(trace, "(defcheck it (eventually (skipped)))")).toBe("true");
	});

	test("a failing form is a critical the (errored) positions can see", () => {
		const trace = ran("(car 1 2 3)");
		expect(
			trace.events.filter(
				(e) => e.kind === "note" && e.severity === "critical",
			),
		).toHaveLength(1);
		expect(verdict(trace, "(defcheck it (eventually (errored)))")).toBe("true");
	});

	test("a clean step leaves no note behind", () => {
		const trace = ran("(+ 1 2)");
		expect(trace.events.filter((e) => e.kind === "note")).toEqual([]);
		expect(verdict(trace, "(defcheck it (eventually (skipped)))")).toBe(
			"false",
		);
	});
});
