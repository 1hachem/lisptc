import { describe, expect, it } from "vitest";
import { ev } from "./helpers.ts";

describe("evaluation errors that must be signalled", () => {
	it("throws on an unbound variable", () => {
		expect(() => ev("no-such-var")).toThrow(/void variable/);
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
		expect(() => ev('"unterminated')).toThrow();
	});
});

describe("arithmetic error conditions", () => {
	it("throws on integer division / remainder by zero", () => {
		expect(() => ev("(% 1 0)")).toThrow();
		expect(() => ev("(truncate 1 0)")).toThrow();
	});

	// Float division by zero yields Infinity rather than an error.
	it("float division by zero produces Infinity", () => {
		expect(ev("(/ 1.0 0)")).toBe("Infinity");
	});
});

/**
 * Robustness probes. These assert the behaviour a strict Lisp *should* have.
 * The current interpreter does little runtime type-checking, so some of these
 * may surface as failures — that is the point: they pin down where the
 * implementation is loose.
 */
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
