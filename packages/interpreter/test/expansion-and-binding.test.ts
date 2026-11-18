import { describe, expect, it } from "vitest";
import { ev } from "./helpers.ts";

describe("macroexpand", () => {
	it("expands a macro call once without evaluating it", () => {
		expect(ev("(macroexpand-1 '(when x (foo)))")).toBe("(cond (x (foo)))");
	});

	it("expands until the head is no longer a macro", () => {
		expect(ev("(macroexpand '(unless x y))")).toBe("(cond ((not x) y))");
	});

	it("returns a form that is not a macro call as it is", () => {
		expect(ev("(macroexpand-1 '(car x))")).toBe("(car x)");
		expect(ev("(macroexpand 42)")).toBe("42");
	});

	it("expands a macro the session defined", () => {
		expect(
			ev("(defmacro twice (x) `(progn ,x ,x)) (macroexpand-1 '(twice (f)))"),
		).toBe("(progn (f) (f))");
	});
});

describe("prog1", () => {
	it("returns the first value after evaluating the rest", () => {
		expect(ev("(let ((x 1)) (list (prog1 x (setq x 2)) x))")).toBe("(1 2)");
	});
});

describe("assert", () => {
	it("returns nil when the test holds", () => {
		expect(ev("(assert (> 2 1))")).toBe("nil");
	});

	it("raises an :assertion error carrying the message and the test form", () => {
		expect(
			ev(
				'(try (assert (> 1 2) "too small") (catch (e) (list (get-in e :kind) (get-in e :message) (get-in e :value))))',
			),
		).toBe('(:assertion "too small" (> 1 2))');
	});
});

describe("ecase", () => {
	it("runs the matching clause", () => {
		expect(ev("(ecase :b (:a 1) (:b 2))")).toBe("2");
	});

	it("raises a :no-match error carrying the key", () => {
		expect(
			ev(
				"(try (ecase :z (:a 1)) (catch (e) (list (get-in e :kind) (get-in e :value))))",
			),
		).toBe("(:no-match :z)");
	});
});

describe("destructuring-bind", () => {
	it("binds a nested pattern with a rest name", () => {
		expect(
			ev(
				"(destructuring-bind (a (b c) &rest d) '(1 (2 3) 4 5) (list a b c d))",
			),
		).toBe("(1 2 3 (4 5))");
	});

	it("binds nil for a missing part", () => {
		expect(ev("(destructuring-bind (a b) '(1) (list a b))")).toBe("(1 nil)");
	});

	it("shadows a parameter of the enclosing function", () => {
		expect(
			ev(
				"(defun f (a) (destructuring-bind (a b) (list a 9) (list b a))) (f 7)",
			),
		).toBe("(9 7)");
	});
});

describe("iterate / recur", () => {
	it("rebinds the names and runs the body again", () => {
		expect(
			ev(
				"(iterate ((i 0) (acc nil)) (if (< i 3) (recur (+ i 1) (cons i acc)) acc))",
			),
		).toBe("(2 1 0)");
	});

	it("does not grow the stack", () => {
		expect(ev("(iterate ((i 0)) (if (< i 200000) (recur (+ i 1)) i))")).toBe(
			"200000",
		);
	});

	it("binds recur to the innermost iterate", () => {
		expect(
			ev(
				"(iterate ((i 0) (out nil)) (if (< i 2) (recur (+ i 1) (cons (iterate ((j 0) (n 0)) (if (< j 3) (recur (+ j 1) (+ n j)) n)) out)) out))",
			),
		).toBe("(3 3)");
	});

	it("evaluates the inits outside the iteration", () => {
		expect(
			ev(
				"(defun fact (n) (iterate ((n n) (acc 1)) (if (< n 2) acc (recur (- n 1) (* acc n))))) (fact 10)",
			),
		).toBe("3628800");
	});
});
