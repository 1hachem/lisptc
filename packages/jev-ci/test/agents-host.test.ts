import { describe, expect, it } from "vitest";
import { affects, guess, touched } from "../src/agents-host.ts";
import type { Block } from "../src/blocks.ts";

function block(text: string, line: number): Block {
	return { id: "b0", heading: "AGENTS.md", text, line };
}

describe("touched", () => {
	it("selects a block a changed line falls inside", () => {
		expect(touched(block("one\ntwo\nthree", 10), new Set([12]))).toBe(true);
	});

	it("leaves a block the change stopped short of", () => {
		expect(touched(block("one\ntwo\nthree", 10), new Set([13]))).toBe(false);
		expect(touched(block("one", 10), new Set([9]))).toBe(false);
	});
});

describe("affects", () => {
	it("selects a block whose evidence is the changed file itself", () => {
		expect(
			affects(["scripts/check-arch.ts"], new Set(["scripts/check-arch.ts"])),
		).toBe(true);
	});

	it("selects a block whose evidence is a directory above the change", () => {
		expect(
			affects(["packages/checks"], new Set(["packages/checks/src/dsl.ts"])),
		).toBe(true);
	});

	it("does not mistake a sibling directory for a parent", () => {
		expect(
			affects(["packages/check"], new Set(["packages/checks/src/dsl.ts"])),
		).toBe(false);
	});

	it("leaves a block nothing in the change reaches", () => {
		expect(affects(["packages/ui"], new Set(["apps/api/src/index.ts"]))).toBe(
			false,
		);
	});
});

describe("guess", () => {
	it("indexes a package by its directory, however many files it holds", () => {
		expect(guess("packages/interpreter")).toContain("packages/interpreter");
	});

	it("indexes a workspace name as the directory that declares it", () => {
		expect(guess("@repo/interpreter")).toContain("packages/interpreter");
	});

	it("leaves a claim about the whole repository to the sweep", () => {
		expect(guess("packages/*")).toEqual([]);
		expect(guess("src/")).toEqual([]);
	});

	it("indexes a suffix convention by the files that honour it", () => {
		const found = guess("-host.ts");

		expect(found).toContain("packages/jev/src/jev-host.ts");
	});

	it("indexes nothing for a path the repository forbids", () => {
		expect(guess("devdocs/")).toEqual([]);
		expect(guess("NOTES.md")).toEqual([]);
	});
});
