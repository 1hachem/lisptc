import type { DocArg } from "@repo/interpreter/docs";
import { describe, expect, it } from "vitest";
import { stringArgAt } from "../src/arg-at.ts";

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

	it("is nothing outside a string", () => {
		expect(nameAt("(f ")).toBeUndefined();
		expect(nameAt('(f "a" ')).toBeUndefined();
	});

	it("reads past an escaped quote inside the open string", () => {
		expect(nameAt('(f "a" "say \\"hi')).toBe("second");
	});

	it("is the innermost call's argument", () => {
		expect(nameAt('(g "z" (f "')).toBe("first");
	});
});
