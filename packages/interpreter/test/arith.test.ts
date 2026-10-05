import { describe, expect, it } from "vitest";
import { compare, convertToString, quotient } from "../src/arith.ts";
import { ev } from "./helpers.ts";

describe("mixed float and integer arithmetic", () => {
	it.each([
		["(+ 1.5 2.5)", "4.0"],
		["(+ 1.5 2)", "3.5"],
		["(- 5.5 1.5)", "4.0"],
		["(- 5.5 1)", "4.5"],
		["(- 5 1.5)", "3.5"],
		["(* 1.5 2.0)", "3.0"],
		["(* 1.5 2)", "3.0"],
		["(* 2 1.5)", "3.0"],
		["(< 1.5 2.5)", "t"],
		["(< 2.5 2)", "nil"],
		["(< 2 2.5)", "t"],
		["(% 5.5 2)", "1.5"],
		["(% 7 2)", "1"],
		["(truncate 7.5)", "7"],
		["(truncate 7 2)", "3"],
	])("%s is %s", (code, expected) => {
		expect(ev(code)).toBe(expected);
	});

	it("rejects truncate with more than two arguments", () => {
		expect(() => ev("(truncate 7 2 1)")).toThrow();
	});
});

describe("arith helpers", () => {
	it("divides bigints exactly", () => {
		expect(quotient(BigInt(7), BigInt(2))).toBe(BigInt(3));
	});

	it("orders bigints", () => {
		expect(compare(BigInt(1), BigInt(2))).toBe(-1);
		expect(compare(BigInt(2), BigInt(1))).toBe(1);
		expect(compare(BigInt(2), BigInt(2))).toBe(0);
	});

	it("leaves exponent notation alone", () => {
		expect(convertToString(1e21)).toBe("1e+21");
		expect(convertToString(1.5)).toBe("1.5");
		expect(convertToString(BigInt(3))).toBe("3");
	});
});
