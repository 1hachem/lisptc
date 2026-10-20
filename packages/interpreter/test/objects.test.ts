import { describe, expect, it } from "vitest";
import {
	arrayToList,
	assert,
	Cell,
	EndOfFile,
	isSpecialForm,
	jsonToLisp,
	lispToJson,
	listToArray,
	mapcar,
	newLispKeyword,
	newSym,
	quoteSym,
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

	it("tells special forms from plain symbols", () => {
		expect(isSpecialForm(quoteSym)).toBe(true);
		expect(isSpecialForm(newSym("car"))).toBe(false);
	});

	it("names its sentinels", () => {
		expect(String(EndOfFile)).toBe("EOF");
		expect(String(Unspecified)).toBe("#<unspecified>");
	});

	it("turns a list into an array", () => {
		expect(listToArray(new Cell(1, new Cell(2, null)))).toEqual([1, 2]);
		expect(listToArray(null)).toEqual([]);
	});

	it("maps nil to nil and keeps an unchanged list", () => {
		expect(mapcar(null, (x) => x)).toBeNull();
		const list = new Cell(1, new Cell(2, null));
		expect(mapcar(list, (x) => x)).toBe(list);
		expect(listToArray(mapcar(list, (x) => (x as number) * 2))).toEqual([2, 4]);
	});

	it("stringifies what JSON cannot carry", () => {
		expect(jsonToLisp(Symbol.for("s"))).toBe("Symbol(s)");
		expect(jsonToLisp(undefined)).toBeNull();
		expect(jsonToLisp(false)).toBeNull();
	});

	it("gives back the JSON that jsonToLisp read", () => {
		const json = {
			region: "north",
			rows: [{ total: 12, open: true }],
			none: null,
		};
		expect(lispToJson(jsonToLisp(json))).toEqual(json);
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

	it("refuses what JSON cannot hold", () => {
		expect(() => lispToJson(new Cell(1n, 2n))).toThrow(/dotted pair/);
		expect(() => lispToJson(newSym("objects-test-sym"))).toThrow(
			/no JSON form/,
		);
		expect(() => lispToJson(Number.NaN)).toThrow(/no JSON form/);
		expect(() => lispToJson(2n ** 64n)).toThrow(/too large/);
	});
});
