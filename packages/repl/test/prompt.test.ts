import { compactionExtension } from "@repo/interpreter/compaction";
import { mcpExtension } from "@repo/interpreter/mcp";
import { proseExtension } from "@repo/interpreter/prose";
import { describe, expect, it } from "vitest";
import { languageReference } from "../src/extensions.ts";
import { MemoryRepl } from "../src/repl.ts";

const sectionIds = (r: MemoryRepl): string[] =>
	r.interp.prompts.sections().map((s) => s.id);

describe("a REPL built from the default roster", () => {
	it("carries one prompt section per extension, plus the core", () => {
		expect(sectionIds(new MemoryRepl())).toEqual([
			"core",
			"secrets",
			"promises",
			"mcp",
			"llm",
			"compaction",
			"prose",
		]);
	});

	it("assembles the same reference whether or not an interpreter exists", () => {
		expect(new MemoryRepl().languageReference).toBe(languageReference());
	});

	it("teaches every capability it installed", () => {
		const reference = new MemoryRepl().languageReference;

		expect(reference).toContain("(load-mcp");
		expect(reference).toContain("(llm/extract");
		expect(reference).toContain('(secret "REPL_TOKEN")');
		expect(reference).toContain("(promise-state");
	});
});

describe("a REPL built from a roster of its own", () => {
	it("teaches only what it installed", () => {
		const r = new MemoryRepl({
			extensions: [compactionExtension(), proseExtension()],
		});

		expect(sectionIds(r)).toEqual(["core", "compaction", "prose"]);
		expect(r.languageReference).toContain("(head x [n])");
		expect(r.languageReference).not.toContain("load-mcp");
		expect(r.languageReference).not.toContain("llm/extract");
		expect(r.languageReference).not.toContain("REPL_TOKEN");
	});

	it("gets the promises section through the extension that installs them", () => {
		const r = new MemoryRepl({ extensions: [mcpExtension()] });

		expect(sectionIds(r)).toEqual(["core", "promises", "mcp"]);
	});
});
