import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { Interp } from "@repo/interpreter/lisp";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { describe, expect, it } from "vitest";

describe("the system prompt an interpreter composes", () => {
	it("says nothing about what the interpreter cannot do", () => {
		const prompt = new Interp({
			extensions: [proseExtension(proseHost)],
		}).systemPrompt();

		expect(prompt).not.toMatch(/\(await /);
		expect(prompt).not.toMatch(/\(secret /);
		expect(prompt).not.toMatch(/:offset/);
	});

	it("teaches remembering only when memory is installed", () => {
		const extension = memoryExtension(memoryHost);
		const interp = new Interp({ extensions: [extension] });
		const prompt = [interp.systemPrompt(), extension.postlude].join("\n");

		expect(prompt).toMatch(/memory\/remember/);
		expect(prompt).toMatch(/memory\/replay/);
	});

	it("teaches windowing only when compaction is installed", () => {
		const extension = compactionExtension(compactionHost);
		const interp = new Interp({ extensions: [extension] });
		const prompt = [interp.systemPrompt(), extension.postlude].join("\n");

		expect(prompt).toMatch(/:offset/);
	});
});
