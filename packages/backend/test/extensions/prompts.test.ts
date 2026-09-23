import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { Interp } from "@repo/interpreter/lisp";
import { LANGUAGE_REFERENCE } from "@repo/interpreter/source";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { secretsExtension } from "@repo/secrets-extension";
import { secretsHost } from "@repo/secrets-extension/host";
import { describe, expect, it } from "vitest";

describe("the system prompt an interpreter composes", () => {
	it("is the language reference alone when no extension was installed", () => {
		expect(new Interp().systemPrompt()).toBe(LANGUAGE_REFERENCE);
	});

	it("carries a section per extension, in the order they were given", () => {
		const prompt = new Interp({
			extensions: [
				secretsExtension(secretsHost),
				promisesExtension(promisesHost),
			],
		}).systemPrompt();

		expect(prompt).toContain(LANGUAGE_REFERENCE);
		expect(prompt.indexOf("SECRETS")).toBeLessThan(prompt.indexOf("PROMISES"));
	});

	it("says nothing about what the interpreter cannot do", () => {
		const prompt = new Interp({
			extensions: [proseExtension(proseHost)],
		}).systemPrompt();

		expect(prompt).not.toMatch(/\(await /);
		expect(prompt).not.toMatch(/\(secret /);
		expect(prompt).not.toMatch(/:offset/);
		expect(prompt).not.toMatch(/memory\/recall/);
	});

	it("teaches remembering only when memory is installed", () => {
		const prompt = new Interp({
			extensions: [memoryExtension(memoryHost)],
		}).systemPrompt();

		expect(prompt).toMatch(/MEMORY/);
		expect(prompt).toMatch(/memory\/remember/);
		expect(prompt).toMatch(/memory\/replay/);
	});

	it("puts memory after compaction, so recall is read the way results are", () => {
		const prompt = new Interp({
			extensions: [
				compactionExtension(compactionHost),
				memoryExtension(memoryHost),
			],
		}).systemPrompt();

		expect(prompt.indexOf("EXTRACT, THEN ECHO")).toBeLessThan(
			prompt.indexOf("MEMORY"),
		);
	});

	it("teaches windowing only when compaction is installed", () => {
		const prompt = new Interp({
			extensions: [compactionExtension(compactionHost)],
		}).systemPrompt();

		expect(prompt).toMatch(/:offset/);
		expect(prompt).toMatch(/EXTRACT, THEN ECHO/);
	});
});
