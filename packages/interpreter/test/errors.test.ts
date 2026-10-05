import { describe, expect, it } from "vitest";
import { cdrCell, VoidVariable } from "../src/errors.ts";
import { Cell } from "../src/objects.ts";
import { ev } from "./helpers.ts";

describe("evaluation errors that must be signalled", () => {
	it("throws on an unbound variable", () => {
		expect(() => ev("(progn no-such-var)")).toThrow(/void variable/);
	});

	it("carries the unbound name on the failure it throws", () => {
		try {
			ev("(progn no-such-var)");
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(VoidVariable);
			expect((error as VoidVariable).variable).toBe("no-such-var");
		}
	});

	it("throws on an undefined function", () => {
		expect(() => ev("(no-such-fn 1 2)")).toThrow(/undefined/);
	});

	it("throws when applying a non-function", () => {
		expect(() => ev("(5 6)")).toThrow(/not applicable/);
	});

	it("throws on arity mismatch (too few / too many)", () => {
		expect(() => ev("((lambda (x) x))")).toThrow(/arity/);
		expect(() => ev("((lambda (x) x) 1 2)")).toThrow(/arity/);
	});

	it("throws on a duplicated argument name", () => {
		expect(() => ev("((lambda (x x) x) 1 2)")).toThrow(/duplicated/);
	});

	it("throws when assigning to a non-variable", () => {
		expect(() => ev("(setq 5 1)")).toThrow(/variable expected/);
	});

	it("throws on malformed quote", () => {
		expect(() => ev("(quote)")).toThrow(/bad quote/);
		expect(() => ev("(quote a b)")).toThrow(/bad quote/);
	});

	it("throws on an unterminated string", () => {
		expect(() => ev('(progn "unterminated)')).toThrow();
	});
});

describe("arithmetic error conditions", () => {
	it("throws on integer division / remainder by zero", () => {
		expect(() => ev("(% 1 0)")).toThrow();
		expect(() => ev("(truncate 1 0)")).toThrow();
	});

	it("float division by zero produces Infinity", () => {
		expect(ev("(/ 1.0 0)")).toBe("Infinity");
	});
});

describe("robustness probes (weak typing)", () => {
	it("car/cdr of a non-list should be an error", () => {
		expect(() => ev("(car 5)")).toThrow();
		expect(() => ev("(cdr 5)")).toThrow();
	});

	it("arithmetic on a non-number should be an error", () => {
		expect(() => ev('(+ 1 "a")')).toThrow();
		expect(() => ev('(+ 1.0 "a")')).toThrow();
		expect(() => ev("(< 1 'sym)")).toThrow();
	});

	it("length of an improper list should be an error", () => {
		expect(() => ev("(length (cons 1 2))")).toThrow();
	});
});

describe("cdrCell", () => {
	it("returns the rest of a proper list and refuses a dotted one", () => {
		const tail = new Cell(2, null);
		expect(cdrCell(new Cell(1, tail))).toBe(tail);
		expect(cdrCell(new Cell(1, null))).toBeNull();
		expect(() => cdrCell(new Cell(1, 2))).toThrow(/proper list expected/);
	});
});
