import { describe, expect, it } from "vitest";
import {
	arrayToList,
	assert,
	Cell,
	EndOfFile,
	lispToJson,
	newLispKeyword,
	newSym,
	Unspecified,
} from "../src/objects.ts";

describe("objects", () => {
	it("fails an assertion with and without a message", () => {
		expect(() => assert(false, "why")).toThrow("Assertion Failure: why");
		expect(() => assert(false)).toThrow("Assertion Failure: ");
	});

	it("refuses to turn an existing symbol into a keyword", () => {
		newSym("objects-test-plain");
		expect(() => newSym("objects-test-plain", true)).toThrow(
			"objects-test-plain",
		);
	});

	it("prints a raw cell as a dotted pair", () => {
		expect(String(new Cell(1, 2))).toBe("(1 . 2)");
	});

	it("names its sentinels", () => {
		expect(String(EndOfFile)).toBe("EOF");
		expect(String(Unspecified)).toBe("#<unspecified>");
	});

	it("writes a plist as an object and a keyword as its name", () => {
		const plist = arrayToList([
			newLispKeyword("type"),
			newLispKeyword("hero"),
			newLispKeyword("n"),
			3n,
		]);
		expect(lispToJson(plist)).toEqual({ type: "hero", n: 3 });
	});

	it("writes a list of plists as an array of objects", () => {
		const row = (n: bigint) => arrayToList([newLispKeyword("total"), n]);
		expect(lispToJson(arrayToList([row(12n), row(7n)]))).toEqual([
			{ total: 12 },
			{ total: 7 },
		]);
	});

	it("writes a list that is neither plist nor alist as an array", () => {
		expect(lispToJson(arrayToList([1n, "a", newLispKeyword("b")]))).toEqual([
			1,
			"a",
			"b",
		]);
	});

	it("writes a list led by :[] as an array of the rest", () => {
		expect(
			lispToJson(
				arrayToList([
					newLispKeyword("[]"),
					newLispKeyword("red"),
					newLispKeyword("green"),
				]),
			),
		).toEqual(["red", "green"]);
	});

	it("refuses an object that names one key twice", () => {
		expect(() =>
			lispToJson(
				arrayToList([newLispKeyword("a"), 1n, newLispKeyword("a"), 2n]),
			),
		).toThrow(/appears twice/);
	});
});
