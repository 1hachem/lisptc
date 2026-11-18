import type { DocArg } from "@repo/interpreter/docs";
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { stringArgAt } from "../src/arg-at.ts";
import { languageService, symbolTable } from "../src/index.ts";

const ARGS: DocArg[] = [
	{ name: "first", type: "string", required: true },
	{ name: "second", type: "string", required: false },
	{ name: "mode", type: "string", required: false },
];

function nameAt(before: string): string | undefined {
	return stringArgAt(before, ARGS)?.name;
}

describe("stringArgAt", () => {
	it("is the first argument in a call's first string", () => {
		expect(nameAt('(f "')).toBe("first");
		expect(nameAt('(f "pa')).toBe("first");
	});

	it("counts the complete positional items before the string", () => {
		expect(nameAt('(f "a" "')).toBe("second");
		expect(nameAt('(f (g 1) "')).toBe("second");
		expect(nameAt("(f 'x \"")).toBe("second");
	});

	it("is the argument the keyword before the string names", () => {
		expect(nameAt('(f :mode "')).toBe("mode");
		expect(nameAt('(f "a" :mode "')).toBe("mode");
	});

	it("skips a keyword's value when counting positions", () => {
		expect(nameAt('(f :mode "x" "')).toBe("first");
	});

	it("is nothing for a keyword that names no argument", () => {
		expect(nameAt('(f :other "')).toBeUndefined();
	});

	it("is nothing past the declared arguments", () => {
		expect(nameAt('(f "a" "b" "c" "')).toBeUndefined();
	});

	it("reads past an escaped quote inside the open string", () => {
		expect(nameAt('(f "a" "say \\"hi')).toBe("second");
	});
});

describe("the values offered inside a string argument", () => {
	const service = languageService(
		symbolTable([
			{
				name: "f",
				args: [
					{
						name: "first",
						type: "string",
						required: true,
						values: [{ value: "one" }],
					},
				],
			},
			{
				name: "g",
				args: [
					{
						name: "server",
						type: "string",
						required: false,
						repeats: true,
						values: [{ value: "playwright" }],
					},
				],
			},
		]),
	);
	const offered = (text: string) => {
		const document = TextDocument.create("file:///t.lisp", "lisp", 1, text);
		return service
			.completions(document, document.positionAt(text.length))
			.map((item) => item.label);
	};

	it("are the last argument's for every position past it when it repeats", () => {
		expect(offered('(g "a" "b" "')).toEqual(["playwright"]);
	});

	it("are none outside a string", () => {
		expect(offered("(f ")).not.toContain("one");
		expect(offered('(f "a" ')).not.toContain("one");
	});

	it("are the innermost call's argument's", () => {
		expect(offered('(g "z" (f "')).toEqual(["one"]);
	});
});
