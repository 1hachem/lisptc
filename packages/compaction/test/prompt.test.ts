import { describe, expect, it } from "vitest";
import { compactionExtension } from "../src/compaction.ts";

describe("the compaction extension teaches its own half of the language", () => {
	const prompt = compactionExtension().prompt ?? "";

	it("reports a result rather than printing it", () => {
		expect(prompt).toMatch(/reports? (one line|a result's name)/i);
	});

	it("says every result is bound to a name", () => {
		expect(prompt).toMatch(/never retype data the REPL/i);
	});

	it("says the extraction commands return rather than print", () => {
		expect(prompt).toMatch(/RETURN a value/);
		expect(prompt).toMatch(/head, tail and grep built-ins RETURN a value/);
	});

	it("says a truncated echo is not the whole output", () => {
		expect(prompt).toMatch(/capped for you.{0,20}not for the user/i);
		expect(prompt).toMatch(/read on with/i);
	});
});
