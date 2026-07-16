import { describe, expect, it } from "vitest";
import { ev } from "./helpers.ts";

describe("recursion and tail-call optimisation", () => {
	it("evaluates moderate non-tail recursion", () => {
		expect(
			ev("(defun sumto (n) (if (= n 0) 0 (+ n (sumto (- n 1))))) (sumto 1000)"),
		).toBe(((1000 * 1001) / 2).toString());
	});

	// A tail-recursive loop to 100k must NOT overflow the stack if TCO works.
	it("handles deep tail recursion without overflowing", () => {
		const expected = (100000n * 100001n) / 2n;
		expect(
			ev(
				"(defun loop (i acc) (if (= i 0) acc (loop (- i 1) (+ acc i)))) " +
					"(loop 100000 0)",
			),
		).toBe(expected.toString());
	});

	it("runs a large dotimes loop (TCO via while)", () => {
		expect(ev("(let ((s 0)) (dotimes (i 100000) (setq s (+ s 1))) s)")).toBe(
			"100000",
		);
	});

	// Mutual recursion in tail position.
	it("supports mutually tail-recursive predicates", () => {
		const program = `
      (defun evenp (n) (if (= n 0) t (oddp (- n 1))))
      (defun oddp (n) (if (= n 0) nil (evenp (- n 1))))
      (list (evenp 50000) (oddp 50000))
    `;
		expect(ev(program)).toBe("(t nil)");
	});

	// Deep NON-tail recursion is expected to exhaust the JS call stack.
	it("overflows on very deep non-tail recursion", () => {
		expect(() =>
			ev(
				"(defun sumto (n) (if (= n 0) 0 (+ n (sumto (- n 1))))) (sumto 200000)",
			),
		).toThrow();
	});
});
