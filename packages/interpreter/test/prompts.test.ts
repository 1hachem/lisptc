import { describe, expect, it } from "vitest";
import { compactionExtension } from "../src/compaction.ts";
import { Interp } from "../src/lisp.ts";
import { promisesExtension } from "../src/promises.ts";
import { proseExtension } from "../src/prose.ts";
import { secretsExtension } from "../src/secrets.ts";
import { LANGUAGE_REFERENCE } from "../src/source.ts";

describe("the system prompt an interpreter composes", () => {
	it("is the language reference alone when no extension was installed", () => {
		expect(new Interp().systemPrompt()).toBe(LANGUAGE_REFERENCE);
	});

	it("carries a section per extension, in the order they were given", () => {
		const prompt = new Interp({
			extensions: [secretsExtension(), promisesExtension()],
		}).systemPrompt();

		expect(prompt).toContain(LANGUAGE_REFERENCE);
		expect(prompt.indexOf("SECRETS")).toBeLessThan(prompt.indexOf("PROMISES"));
	});

	it("says nothing about what the interpreter cannot do", () => {
		const prompt = new Interp({
			extensions: [proseExtension()],
		}).systemPrompt();

		expect(prompt).not.toMatch(/\(await /);
		expect(prompt).not.toMatch(/\(secret /);
		expect(prompt).not.toMatch(/:offset/);
	});

	it("teaches windowing only when compaction is installed", () => {
		const prompt = new Interp({
			extensions: [compactionExtension()],
		}).systemPrompt();

		expect(prompt).toMatch(/:offset/);
		expect(prompt).toMatch(/EXTRACT, THEN ECHO/);
	});
});
