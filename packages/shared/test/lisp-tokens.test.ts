import { describe, expect, it } from "vitest";
import { isKeywordToken, isQuoteToken, numberIn } from "../src/lisp-tokens.ts";

describe("an atom reads as a number exactly when the reader parses one", () => {
	it("reads integers as bigints and the rest as floats", () => {
		expect(numberIn("42")).toBe(42n);
		expect(numberIn("0x1F")).toBe(31n);
		expect(numberIn("-.5")).toBe(-0.5);
		expect(numberIn("1e3")).toBe(1000);
		expect(numberIn("Infinity")).toBe(Number.POSITIVE_INFINITY);
	});

	it("leaves a sign alone and anything that is not a number", () => {
		for (const token of ["+", "-", "NaN", "1-2", "x1"])
			expect(numberIn(token)).toBeNull();
	});
});

describe("the reader's prefixes and keywords", () => {
	it("quotes with ' ` , and ,@ and nothing else", () => {
		for (const token of ["'", "`", ",", ",@"])
			expect(isQuoteToken(token)).toBe(true);
		for (const token of ["~", "@", "#"])
			expect(isQuoteToken(token)).toBe(false);
	});

	it("takes a colon before a name as a keyword, and a bare colon as a symbol", () => {
		expect(isKeywordToken(":loud")).toBe(true);
		expect(isKeywordToken(":")).toBe(false);
		expect(isKeywordToken("a:b")).toBe(false);
	});
});
