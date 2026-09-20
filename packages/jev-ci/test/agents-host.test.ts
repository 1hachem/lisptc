import { describe, expect, it } from "vitest";
import { addedLines, type Hunk, patch, touched } from "../src/agents-host.ts";
import type { Block } from "../src/blocks.ts";

function block(text: string, line: number): Block {
	return { id: "b0", heading: "AGENTS.md", text, line };
}

function hunk(line: number, span: number, ...lines: string[]): Hunk {
	return { line, span, lines };
}

describe("addedLines", () => {
	it("spreads a hunk over every line it writes", () => {
		expect([...addedLines([hunk(10, 3, "+a", "+b", "+c")])]).toEqual([
			10, 11, 12,
		]);
	});

	it("writes no line for a hunk that only deletes", () => {
		expect([...addedLines([hunk(10, 0, "-gone")])]).toEqual([]);
	});
});

describe("touched", () => {
	it("selects a block a changed line falls inside", () => {
		expect(touched(block("one\ntwo\nthree", 10), new Set([12]))).toBe(true);
	});

	it("leaves a block the change stopped short of", () => {
		expect(touched(block("one\ntwo\nthree", 10), new Set([13]))).toBe(false);
		expect(touched(block("one", 10), new Set([9]))).toBe(false);
	});
});

describe("patch", () => {
	it("carries the diff of the hunk that rewrote the block", () => {
		const found = [hunk(10, 1, "-was", "+is"), hunk(40, 1, "+elsewhere")];

		expect(patch(block("is\ntwo", 10), found)).toEqual(["-was", "+is"]);
	});

	it("gathers every hunk the block spans", () => {
		const found = [hunk(10, 1, "+first"), hunk(12, 1, "+third")];

		expect(patch(block("one\ntwo\nthree", 10), found)).toEqual([
			"+first",
			"+third",
		]);
	});

	it("leaves a hunk that stops one line short", () => {
		expect(patch(block("one\ntwo", 10), [hunk(12, 1, "+after")])).toEqual([]);
		expect(patch(block("one\ntwo", 10), [hunk(9, 1, "+before")])).toEqual([]);
	});

	it("carries a deletion that landed inside the block", () => {
		expect(patch(block("one\ntwo", 10), [hunk(10, 0, "-gone")])).toEqual([
			"-gone",
		]);
	});
});
