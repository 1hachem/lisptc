import { describe, expect, it } from "vitest";
import { EvalException } from "../src/errors.ts";
import {
	arrayToList,
	listToArray,
	newLispKeyword,
	Sym,
} from "../src/objects.ts";
import {
	keyName,
	parsePlist,
	plistOptions,
	splitKeywordArgs,
} from "../src/plist.ts";

const k = newLispKeyword;

describe("keyName", () => {
	it("reads a keyword, a symbol and a string", () => {
		expect(keyName(k("a"))).toBe("a");
		expect(keyName(new Sym("b"))).toBe("b");
		expect(keyName("c")).toBe("c");
	});

	it("refuses anything else", () => {
		expect(() => keyName(1)).toThrow("keyword expected as key");
	});
});

describe("parsePlist", () => {
	it("pairs each key with the value after it", () => {
		expect([...parsePlist(arrayToList([k("a"), 1, "b", 2]))]).toEqual([
			["a", 1],
			["b", 2],
		]);
	});

	it("refuses a key with no value", () => {
		expect(() => parsePlist(arrayToList([k("a")]))).toThrow(
			"odd-length keyword list",
		);
	});
});

describe("splitKeywordArgs", () => {
	it("splits positional values from the options that follow", () => {
		const { values, options } = splitKeywordArgs(
			arrayToList([1, 2, k("x"), 3]),
			[],
		);
		expect(listToArray(values)).toEqual([1, 2]);
		expect(listToArray(options)).toEqual([k("x"), 3]);
	});

	it("keeps a trailing keyword as a value unless it is allowed", () => {
		const kept = splitKeywordArgs(arrayToList([1, k("x")]), []);
		expect(listToArray(kept.values)).toEqual([1, k("x")]);
		expect(kept.options).toBeNull();
		const split = splitKeywordArgs(arrayToList([1, k("x")]), ["x"]);
		expect(listToArray(split.values)).toEqual([1]);
		expect(listToArray(split.options)).toEqual([k("x")]);
	});
});

describe("plistOptions", () => {
	it("returns the allowed options", () => {
		expect(plistOptions(arrayToList([k("a"), 1]), ["a"]).get("a")).toBe(1);
	});

	it("names the allowed options when it meets another", () => {
		const call = () => plistOptions(arrayToList([k("z"), 1]), ["a", "b"]);
		expect(call).toThrow(EvalException);
		expect(call).toThrow("unknown option; expected one of :a :b: :z");
	});
});
