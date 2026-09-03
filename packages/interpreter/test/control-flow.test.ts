import { describe, expect, it } from "vitest";
import { ev } from "./helpers.ts";

describe("cond / if / when", () => {
	it("cond selects the first true clause", () => {
		expect(ev("(cond (nil 1) (t 2))")).toBe("2");
		expect(ev("(cond)")).toBe("nil");
		expect(ev("(cond (nil 1))")).toBe("nil");
	});

	it("cond returns the test value for a single-element clause", () => {
		expect(ev("(cond (5))")).toBe("5");
		expect(ev("(cond (nil) (7))")).toBe("7");
	});

	it("if requires no else", () => {
		expect(ev("(if t 1 2)")).toBe("1");
		expect(ev("(if nil 1 2)")).toBe("2");
		expect(ev("(if nil 1)")).toBe("nil");
		expect(ev("(if t 1)")).toBe("1");
	});

	it("if runs multiple else forms", () => {
		expect(ev("(if nil 1 2 3 4)")).toBe("4");
	});

	it("when runs the body only when the test holds", () => {
		expect(ev("(when t 1 2 3)")).toBe("3");
		expect(ev("(when nil 1)")).toBe("nil");
	});

	it("unless runs the body only when the test fails", () => {
		expect(ev("(unless nil 1 2 3)")).toBe("3");
		expect(ev("(unless t 1)")).toBe("nil");
	});
});

describe("case", () => {
	it("matches a clause whose keylist contains the key", () => {
		expect(ev("(case 2 ((1 2 3) 'a) ((4 5) 'b) (t 'c))")).toBe("a");
		expect(ev("(case 5 ((1 2 3) 'a) ((4 5) 'b) (t 'c))")).toBe("b");
	});

	it("matches a single non-list key", () => {
		expect(ev("(case 'x (x 'matched) (t 'default))")).toBe("matched");
	});

	it("falls through to the t default clause", () => {
		expect(ev("(case 99 ((1 2) 'a) (t 'default))")).toBe("default");
	});

	it("returns nil when nothing matches and there is no default", () => {
		expect(ev("(case 99 ((1 2) 'a))")).toBe("nil");
	});

	it("disambiguates a literal t key from the default clause", () => {
		expect(ev("(case t ((t) 'literal) (t 'default))")).toBe("literal");
		expect(ev("(case 99 ((t) 'literal) (t 'default))")).toBe("default");
	});

	it("evaluates key-expr exactly once", () => {
		expect(
			ev(
				"(setq n 0) (defun next () (setq n (+ n 1)) n) (case (next) (1 'ok) (t 'bad)) (progn n)",
			),
		).toBe("1");
	});
});

describe("and / or short-circuiting", () => {
	it("and returns the last value or nil", () => {
		expect(ev("(and 1 2 3)")).toBe("3");
		expect(ev("(and 1 nil 3)")).toBe("nil");
	});

	it("and does not evaluate past a nil", () => {
		// If the tail were evaluated, the unbound function would throw.
		expect(ev("(and nil (undefined-fn))")).toBe("nil");
	});

	it("or returns the first true value or nil", () => {
		expect(ev("(or nil nil 5)")).toBe("5");
		expect(ev("(or nil nil)")).toBe("nil");
		expect(ev("(or 1 (undefined-fn))")).toBe("1");
	});

	it("not / null negate truthiness", () => {
		expect(ev("(not nil)")).toBe("t");
		expect(ev("(not 5)")).toBe("nil");
		expect(ev("(null nil)")).toBe("t");
	});
});

describe("progn / sequencing", () => {
	it("returns the last form", () => {
		expect(ev("(progn 1 2 3)")).toBe("3");
		expect(ev("(progn)")).toBe("nil");
	});
});

describe("let / lambda / lexical scope", () => {
	it("binds with let and shadows", () => {
		expect(ev("(let ((x 1) (y 2)) (+ x y))")).toBe("3");
		expect(ev("(let ((x 1)) (let ((x 2)) x))")).toBe("2");
		expect(ev("(let (x) x)")).toBe("nil");
	});

	it("binds sequentially with let*, each binding seeing the previous", () => {
		expect(ev("(let* ((x 1) (y (+ x 1)) (z (* y 3))) (list x y z))")).toBe(
			"(1 2 6)",
		);
		expect(ev("(let* () 42)")).toBe("42");
		expect(ev("(let* ((a 1) b) (list a b))")).toBe("(1 nil)");
		expect(ev("(let ((x 1)) (let* ((x 2) (y x)) y))")).toBe("2");
	});

	it("let* nests deeply, past the macro-expansion limit", () => {
		// The whole nest is built in ONE expansion step, so it is not capped by
		// the 20-nesting limit expandMacros applies to a compiled body.
		const bindings = Array.from({ length: 40 }, (_, i) => `(v${i} ${i})`).join(
			" ",
		);
		expect(ev(`(defun f () (let* (${bindings}) v39)) (f)`)).toBe("39");
	});

	it("applies lambdas, including &rest", () => {
		expect(ev("((lambda (x) (* x x)) 5)")).toBe("25");
		expect(ev("((lambda (x &rest r) r) 1 2 3)")).toBe("(2 3)");
		expect(ev("((lambda (&rest r) r) 1 2 3)")).toBe("(1 2 3)");
		expect(ev("((lambda (&rest r) r))")).toBe("nil");
	});

	it("closures capture the defining environment lexically", () => {
		expect(ev("(((lambda (a) (lambda (b) (+ a b))) 3) 4)")).toBe("7");
	});

	it("functions see globals lexically, not the caller's locals", () => {
		expect(ev("(setq x 10) (defun f () x) (defun g (x) (f)) (g 99)")).toBe(
			"10",
		);
	});

	it("setq on a parameter mutates the frame, not the global", () => {
		expect(ev("(setq z 1) (defun h (z) (setq z 100) z) (list (h 5) z)")).toBe(
			"(100 1)",
		);
	});
});

describe("closures with mutable captured state", () => {
	const counter = `
    (defun make-counter ()
      (let ((n 0))
        (lambda () (setq n (+ n 1)))))
  `;

	it("increments captured state across calls", () => {
		expect(ev(`${counter} (setq c (make-counter)) (c) (c) (c)`)).toBe("3");
	});

	it("keeps independent state per closure", () => {
		expect(
			ev(
				`${counter}
         (setq c1 (make-counter))
         (setq c2 (make-counter))
         (c1) (c1) (c2)
         (list (c1) (c2))`,
			),
		).toBe("(3 2)");
	});
});
