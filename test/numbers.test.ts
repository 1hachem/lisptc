import { describe, expect, it } from "vitest";
import { ev } from "./helpers.ts";

// Integers are exact (BigInt); floats are inexact (Number) and print with a
// trailing ".0" when integer-valued. These tests pin down that contract and
// the mixed-arithmetic coercion rules.
describe("integer arithmetic (exact / bigint)", () => {
	it("adds and folds", () => {
		expect(ev("(+ 1 2)")).toBe("3");
		expect(ev("(+ 1 2 3 4 5)")).toBe("15");
		expect(ev("(+)")).toBe("0");
	});

	it("multiplies", () => {
		expect(ev("(* 2 3 4)")).toBe("24");
		expect(ev("(*)")).toBe("1");
	});

	it("subtracts and negates", () => {
		expect(ev("(- 5)")).toBe("-5");
		expect(ev("(- 10 1 2 3)")).toBe("4");
		expect(ev("(- 5 3 4)")).toBe("-2");
	});

	it("stays exact for large integers", () => {
		expect(ev("(* 100000000000 100000000000)")).toBe(
			(100000000000n * 100000000000n).toString(),
		);
		let fact = 1n;
		for (let i = 1n; i <= 30n; i++) fact *= i;
		expect(
			ev("(defun fact (n) (if (= n 0) 1 (* n (fact (- n 1))))) (fact 30)"),
		).toBe(fact.toString());
	});
});

describe("float arithmetic (inexact / number)", () => {
	it("prints integer-valued floats with .0", () => {
		expect(ev("2.0")).toBe("2.0");
		expect(ev("1.5")).toBe("1.5");
	});

	it("division always produces a float", () => {
		expect(ev("(/ 6 3)")).toBe("2.0");
		expect(ev("(/ 7 2)")).toBe("3.5");
		expect(ev("(/ 1 4)")).toBe("0.25");
		expect(ev("(/ 12 2 3)")).toBe("2.0");
	});

	it("contaminates integer operands to float", () => {
		expect(ev("(+ 1 2.0)")).toBe("3.0");
		expect(ev("(* 2 2.5)")).toBe("5.0");
	});
});

describe("truncate / remainder / mod", () => {
	it("truncates toward zero", () => {
		expect(ev("(truncate 7 2)")).toBe("3");
		expect(ev("(truncate -7 2)")).toBe("-3");
		expect(ev("(truncate 7)")).toBe("7");
	});

	it("% keeps the sign of the dividend", () => {
		expect(ev("(% 7 3)")).toBe("1");
		expect(ev("(% -7 3)")).toBe("-1");
	});

	it("mod keeps the sign of the divisor", () => {
		expect(ev("(mod -7 3)")).toBe("2");
		expect(ev("(mod 7 -3)")).toBe("-2");
		expect(ev("(mod 7 3)")).toBe("1");
	});
});

describe("comparisons and numeric equality", () => {
	it("orders numbers", () => {
		expect(ev("(< 1 2)")).toBe("t");
		expect(ev("(< 2 2)")).toBe("nil");
		expect(ev("(> 3 2)")).toBe("t");
		expect(ev("(<= 2 2)")).toBe("t");
		expect(ev("(>= 2 3)")).toBe("nil");
		expect(ev("(/= 1 2)")).toBe("t");
		expect(ev("(= 2 2)")).toBe("t");
	});

	it("compares across exact/inexact representations", () => {
		expect(ev("(= 1 1.0)")).toBe("t");
		expect(ev("(< 1 1.5)")).toBe("t");
	});

	it("eq is identity, eql is numeric value equality", () => {
		expect(ev("(eq 1 1)")).toBe("t");
		expect(ev("(eq 1 1.0)")).toBe("nil"); // bigint vs number: not identical
		expect(ev("(eql 1 1.0)")).toBe("t");
	});

	it("numberp classifies numbers only", () => {
		expect(ev("(numberp 3)")).toBe("t");
		expect(ev("(numberp 3.0)")).toBe("t");
		expect(ev('(numberp "3")')).toBe("nil");
		expect(ev("(numberp nil)")).toBe("nil");
	});
});
