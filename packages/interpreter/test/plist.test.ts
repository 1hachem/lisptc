import { describe, expect, it } from "vitest";
import { EvalException } from "../src/errors.ts";
import { arrayToList, newLispKeyword } from "../src/objects.ts";
import { keyName, plistOptions } from "../src/plist.ts";

const k = newLispKeyword;

describe("keyName", () => {
	it("refuses anything else", () => {
		expect(() => keyName(1)).toThrow("keyword expected as key");
	});
});

describe("plistOptions", () => {
	it("names the allowed options when it meets another", () => {
		const call = () => plistOptions(arrayToList([k("z"), 1]), ["a", "b"]);
		expect(call).toThrow(EvalException);
		expect(call).toThrow("unknown option; expected one of :a :b: :z");
	});
});
