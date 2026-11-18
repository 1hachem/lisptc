import { describe, expect, it } from "vitest";
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

describe("integers past the float range", () => {
	it("divides them exactly", () => {
		expect(ev("(truncate 100000000000000000000000000001 2)")).toBe(
			"50000000000000000000000000000",
		);
	});

	it("orders them", () => {
		expect(ev("(< 100000000000000000001 100000000000000000002)")).toBe("t");
		expect(ev("(< 100000000000000000002 100000000000000000001)")).toBe("nil");
		expect(ev("(< 100000000000000000001 100000000000000000001)")).toBe("nil");
	});
});

describe("a float too large for plain digits", () => {
	it("prints in exponent notation", () => {
		expect(ev("1e21")).toBe("1e+21");
		expect(ev("(string 1e21)")).toBe('"1e+21"');
		expect(ev("1.5")).toBe("1.5");
	});
});
