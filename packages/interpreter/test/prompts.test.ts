import { describe, expect, it } from "vitest";
import { compactionExtension } from "../src/extensions/compaction/compaction.ts";
import { memoryExtension } from "../src/extensions/memory/memory.ts";
import { promisesExtension } from "../src/extensions/promises/promises.ts";
import { proseExtension } from "../src/extensions/prose/prose.ts";
import { secretsExtension } from "../src/extensions/secrets/secrets.ts";
import { Interp } from "../src/lisp.ts";
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
		expect(prompt).not.toMatch(/memory\/recall/);
	});

	it("teaches remembering only when memory is installed", () => {
		const prompt = new Interp({
			extensions: [memoryExtension()],
		}).systemPrompt();

		expect(prompt).toMatch(/MEMORY/);
		expect(prompt).toMatch(/memory\/remember/);
		expect(prompt).toMatch(/memory\/replay/);
	});

	it("puts memory after compaction, so recall is read the way results are", () => {
		const prompt = new Interp({
			extensions: [compactionExtension(), memoryExtension()],
		}).systemPrompt();

		expect(prompt.indexOf("EXTRACT, THEN ECHO")).toBeLessThan(
			prompt.indexOf("MEMORY"),
		);
	});

	it("teaches windowing only when compaction is installed", () => {
		const prompt = new Interp({
			extensions: [compactionExtension()],
		}).systemPrompt();

		expect(prompt).toMatch(/:offset/);
		expect(prompt).toMatch(/EXTRACT, THEN ECHO/);
	});
});
