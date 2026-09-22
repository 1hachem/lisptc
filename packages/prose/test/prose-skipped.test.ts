import { describe, expect, it } from "vitest";
import { proseSkipped } from "../src/prose.ts";
import { proseInterp } from "./helpers.ts";

describe("what a step left unrun", () => {
	it("spans the aside it read as prose, and leaves the form it ran alone", () => {
		expect(
			proseSkipped(proseInterp(), "an aside (see below)\n(+ 1 2)"),
		).toEqual([{ span: [9, 20], reason: '"see" is not defined' }]);
	});

	it("tells two forms with the same head apart", () => {
		const text = "(I will check (the thing)) (I will check (+ 1 2))";
		expect(proseSkipped(proseInterp(), text)).toEqual([
			{ span: [0, 26], reason: '"I" is not defined' },
		]);
		expect(text.slice(27, 49)).toBe("(I will check (+ 1 2))");
	});

	it("spans a form it could not read", () => {
		const [only, ...rest] = proseSkipped(proseInterp(), "Working on (echo 1");
		expect(rest).toEqual([]);
		expect(only.span).toEqual([11, 18]);
		expect(only.reason).toContain("unexpected end of input");
	});

	it("says nothing about a reply that is all prose", () => {
		expect(proseSkipped(proseInterp(), "The answer is 42.")).toEqual([]);
	});
});
