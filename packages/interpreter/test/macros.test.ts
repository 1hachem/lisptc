import { describe, expect, it } from "vitest";
import { ev } from "./helpers.ts";

describe("defmacro / defun return values", () => {
	it("defun returns the defined name", () => {
		expect(ev("(defun ff () 1)")).toBe("ff");
	});

	it("defmacro returns the defined name", () => {
		expect(ev("(defmacro mm () 1)")).toBe("mm");
	});
});

describe("quasiquote / unquote / splicing", () => {
	it("substitutes with unquote", () => {
		expect(ev("(setq a 5) `(1 ,a 3)")).toBe("(1 5 3)");
		expect(ev("(setq a 5) `(,a . ,a)")).toBe("(5 . 5)");
	});

	it("splices with unquote-splicing", () => {
		expect(ev("`(1 ,@(list 2 3) 4)")).toBe("(1 2 3 4)");
		expect(ev("`(,@(list 1 2) ,@(list 3 4))")).toBe("(1 2 3 4)");
	});

	it("leaves plain elements quoted", () => {
		expect(ev("`(a b c)")).toBe("(a b c)");
	});

	it("does not evaluate unquotes inside a nested quasiquote", () => {
		expect(ev("`(1 `(2 ,(+ 1 2)))")).toBe("(1 `(2 ,(+ 1 2)))");
	});
});

describe("user macros expand correctly", () => {
	it("expands a swap! macro that mutates two variables", () => {
		expect(
			ev(
				"(defmacro swap (a b) `(let ((tmp ,a)) (setq ,a ,b) (setq ,b tmp))) " +
					"(setq p 1) (setq q 2) (swap p q) (list p q)",
			),
		).toBe("(2 1)");
	});

	it("expands a macro used inside a compiled function body", () => {
		expect(
			ev(
				"(defmacro double (x) `(* 2 ,x)) " +
					"(defun quad (n) (double (double n))) (quad 5)",
			),
		).toBe("20");
	});
});

describe("gensym", () => {
	it("produces distinct fresh symbols", () => {
		expect(ev("(eq (gensym) (gensym))")).toBe("nil");
		expect(ev("(stringp (symbol-name (gensym)))")).toBe("t");
	});

	// The `while` macro binds its loop via a gensym; a user variable named
	// `loop` must not be captured by it.
	it("keeps macro-introduced bindings hygienic", () => {
		expect(
			ev(
				"(let ((loop 99)) (let ((i 0)) (while (< i 3) (setq i (+ i 1))) loop))",
			),
		).toBe("99");
	});
});

describe("iteration macros built on TCO", () => {
	it("while accumulates", () => {
		expect(
			ev(
				"(let ((i 0) (s 0)) (while (< i 10) (setq s (+ s i)) (setq i (+ i 1))) s)",
			),
		).toBe("45");
	});

	it("dotimes iterates count times", () => {
		expect(ev("(let ((s 0)) (dotimes (i 5) (setq s (+ s i))) s)")).toBe("10");
	});

	it("dolist walks a list with an optional result form", () => {
		expect(ev("(let ((s 0)) (dolist (x '(1 2 3 4) s) (setq s (+ s x))))")).toBe(
			"10",
		);
	});
});
