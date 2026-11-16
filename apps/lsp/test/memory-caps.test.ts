import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import {
	languageService,
	symbolsOf,
	symbolTable,
} from "@repo/language-service";
import { MAX_BUILTIN_WORDS } from "@repo/memory-extension";
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { docExtensions } from "../src/extensions.ts";

function diagnose(text: string): string[] {
	const interp = new Interp({ extensions: docExtensions() });
	runSync(interp, prelude);
	const service = languageService(symbolTable(symbolsOf(interp)));
	return service
		.diagnostics(
			TextDocument.create("file:///a.memories.ptc", "lisptc", 1, text),
		)
		.map((d) => d.message);
}

function words(count: number): string {
	return Array.from({ length: count }, () => "w").join(" ");
}

describe("a built-in memory in the editor", () => {
	it("is flagged when its body is past the built-in cap", () => {
		expect(
			diagnose(`(memory "a/b" :when "x"\n  "${words(MAX_BUILTIN_WORDS + 1)}")`),
		).toEqual([
			`memory: holds at most ${MAX_BUILTIN_WORDS} words here, this one has ${MAX_BUILTIN_WORDS + 1}`,
		]);
	});

	it("is left alone at the cap", () => {
		expect(
			diagnose(`(memory "a/b" :when "x"\n  "${words(MAX_BUILTIN_WORDS)}")`),
		).toEqual([]);
	});
});
