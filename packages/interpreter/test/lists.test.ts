import { describe, expect, it } from "vitest";
import { ev } from "./helpers.ts";

describe("core list accessors", () => {
	it("car / cdr, guarded on nil", () => {
		expect(ev("(car '(1 2 3))")).toBe("1");
		expect(ev("(cdr '(1 2 3))")).toBe("(2 3)");
		expect(ev("(car nil)")).toBe("nil");
		expect(ev("(cdr nil)")).toBe("nil");
	});

	it("cons / list / length", () => {
		expect(ev("(cons 1 '(2 3))")).toBe("(1 2 3)");
		expect(ev("(list 1 2 3)")).toBe("(1 2 3)");
		expect(ev("(list)")).toBe("nil");
		expect(ev("(length '(1 2 3))")).toBe("3");
		expect(ev("(length nil)")).toBe("0");
		expect(ev('(length "hello")')).toBe("5");
	});

	it("compound accessors from the prelude", () => {
		expect(ev("(cadr '(1 2 3))")).toBe("2");
		expect(ev("(caddr '(1 2 3))")).toBe("3");
		expect(ev("(cddr '(1 2 3))")).toBe("(3)");
	});
});

describe("append / mapcar / membership / assoc", () => {
	it("append is non-destructive and variadic", () => {
		expect(ev("(append '(1 2) '(3 4))")).toBe("(1 2 3 4)");
		expect(ev("(append '(1) '(2) '(3))")).toBe("(1 2 3)");
		expect(ev("(append nil '(1))")).toBe("(1)");
		expect(ev("(append '(1) nil)")).toBe("(1)");
	});

	it("mapcar maps a function over a list", () => {
		expect(ev("(mapcar (lambda (x) (* x x)) '(1 2 3))")).toBe("(1 4 9)");
		expect(ev("(mapcar car '((1 a) (2 b)))")).toBe("(1 2)");
	});

	it("member / memq", () => {
		expect(ev("(member 3 '(1 2 3 4))")).toBe("(3 4)");
		expect(ev("(member 9 '(1 2 3))")).toBe("nil");
		expect(ev("(memq 'b '(a b c))")).toBe("(b c)");
	});

	it("assoc / assq", () => {
		expect(ev("(assoc 'b '((a 1) (b 2)))")).toBe("(b 2)");
		expect(ev("(assq 'x '((a 1)))")).toBe("nil");
	});

	it("last", () => {
		expect(ev("(last '(1 2 3))")).toBe("(3)");
	});
});

describe("equality predicates on structures", () => {
	it("equal is deep, eq/eql are shallow", () => {
		expect(ev("(equal '(1 (2 3)) '(1 (2 3)))")).toBe("t");
		expect(ev("(equal '(1 2) '(1 2 3))")).toBe("nil");
		expect(ev("(eq '(1 2) '(1 2))")).toBe("nil"); // distinct cons cells
		expect(ev('(equal "abc" "abc")')).toBe("t");
	});
});

describe("destructive operations", () => {
	it("rplaca / rplacd mutate cells in place", () => {
		expect(ev("(setq l (list 1 2 3)) (rplaca l 9) (progn l)")).toBe("(9 2 3)");
		expect(ev("(setq l (list 1 2 3)) (rplacd l '(8)) (progn l)")).toBe("(1 8)");
	});

	it("nreverse reverses in place", () => {
		expect(ev("(nreverse (list 1 2 3))")).toBe("(3 2 1)");
	});

	it("nconc concatenates in place", () => {
		expect(ev("(setq a (list 1 2)) (setq b (list 3 4)) (nconc a b) a")).toBe(
			"(1 2 3 4)",
		);
	});
});

describe("apply", () => {
	it("applies functions to argument lists", () => {
		expect(ev("(apply + '(1 2 3))")).toBe("6");
		expect(ev("(apply cons '(1 2))")).toBe("(1 . 2)");
		expect(ev("(apply list '(1 2 3))")).toBe("(1 2 3)");
	});
});
