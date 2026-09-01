import { describe, expect, it } from "vitest";
import { ev } from "./helpers.ts";

describe("reader: lists and dotted pairs", () => {
	it("reads proper lists", () => {
		expect(ev("'(1 2 3)")).toBe("(1 2 3)");
		expect(ev("'(a (b c) d)")).toBe("(a (b c) d)");
		expect(ev("'()")).toBe("nil");
		expect(ev("'(())")).toBe("(nil)");
		expect(ev("'(1 (2 (3 (4 (5)))))")).toBe("(1 (2 (3 (4 (5)))))");
	});

	it("reads and prints dotted pairs", () => {
		expect(ev("(cons 1 2)")).toBe("(1 . 2)");
		expect(ev("'(1 . 2)")).toBe("(1 . 2)");
		expect(ev("'(1 2 . 3)")).toBe("(1 2 . 3)");
	});

	it("normalises fully-dotted list notation", () => {
		expect(ev("'(a . (b . (c . nil)))")).toBe("(a b c)");
	});
});

describe("reader: atoms", () => {
	it("recognises nil and t", () => {
		expect(ev("(progn nil)")).toBe("nil");
		expect(ev("(progn 'nil)")).toBe("nil");
		expect(ev("(progn t)")).toBe("t");
		expect(ev("(progn 't)")).toBe("t");
	});

	it("interns symbols (eq identity)", () => {
		expect(ev("(eq 'foo 'foo)")).toBe("t");
		expect(ev("(eq 'foo 'bar)")).toBe("nil");
		expect(ev('(eq (intern "y") (intern "y"))')).toBe("t");
		expect(ev('(eq (make-symbol "x") (make-symbol "x"))')).toBe("nil");
	});

	it("treats bare + and - as symbols, not numbers", () => {
		expect(ev("(eq '- '-)")).toBe("t");
		expect(ev("(eq '+ '+)")).toBe("t");
	});
});

describe("reader: numeric tokens go through BigInt/Number", () => {
	it("parses plain decimals", () => {
		expect(ev("(progn 16)")).toBe("16");
		expect(ev("(progn -42)")).toBe("-42");
	});

	// BigInt() accepts 0x/0o/0b prefixes, so these tokens parse as integers.
	it("accepts radix-prefixed integer literals", () => {
		expect(ev("(progn 0x10)")).toBe("16");
		expect(ev("(progn 0o17)")).toBe("15");
		expect(ev("(progn 0b1010)")).toBe("10");
	});
});

describe("reader: strings and escapes", () => {
	it("round-trips simple strings", () => {
		expect(ev('(progn "hello")')).toBe('"hello"');
		expect(ev('(progn "")')).toBe('""');
	});

	it("unescapes on read and re-escapes on print", () => {
		expect(ev('(progn "a\\nb")')).toBe('"a\\nb"');
		expect(ev('(progn "tab\\there")')).toBe('"tab\\there"');
		expect(ev('(progn "quote\\"inside")')).toBe('"quote\\"inside"');
		expect(ev('(progn "back\\\\slash")')).toBe('"back\\\\slash"');
	});

	it("collapses (quote x) to shorthand when printing", () => {
		expect(ev("(list 'quote 'a)")).toBe("'a");
		expect(ev("(list 'quasiquote 'a)")).toBe("`a");
		expect(ev("(progn ''a)")).toBe("'a");
	});
});
