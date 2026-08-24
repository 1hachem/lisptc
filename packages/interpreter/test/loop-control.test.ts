import { describe, expect, it } from "vitest";
import { ev } from "./helpers.ts";

describe("break / return in while", () => {
	it("break stops the loop early, returning nil", () => {
		expect(
			ev("(let ((n 0)) (while t (setq n (+ n 1)) (if (= n 3) (break))) n)"),
		).toBe("3");
	});

	it("return stops the loop early with the given value", () => {
		expect(
			ev("(setq n 0) (while t (setq n (+ n 1)) (if (= n 3) (return 'done)))"),
		).toBe("done");
	});

	it("return nil is distinguishable from a plain break", () => {
		expect(ev("(while t (return nil))")).toBe("nil");
	});
});

describe("break / return in dotimes", () => {
	it("break skips the result form", () => {
		expect(ev("(dotimes (i 10 'done) (if (= i 3) (break)))")).toBe("nil");
	});

	it("return produces the given value instead of running the result form", () => {
		expect(ev("(dotimes (i 10 'done) (if (= i 3) (return 'stopped)))")).toBe(
			"stopped",
		);
	});

	it("runs the result form on normal completion", () => {
		expect(ev("(dotimes (i 10 'done))")).toBe("done");
	});
});

describe("break / return in dolist", () => {
	it("return skips the result form and yields its value", () => {
		expect(
			ev("(dolist (x '(1 2 3 4 5) 'finished) (if (= x 3) (return 'early)))"),
		).toBe("early");
	});

	it("runs the result form on normal completion", () => {
		expect(ev("(dolist (x '(1 2 3) 'done))")).toBe("done");
	});
});

describe("nested loops", () => {
	it("break only exits the innermost loop", () => {
		expect(
			ev(`
      (let ((outer 0) (inner-count 0))
        (dotimes (i 3)
          (setq outer (+ outer 1))
          (dotimes (j 10)
            (setq inner-count (+ inner-count 1))
            (if (= j 2) (break))))
        (list outer inner-count))
    `),
		).toBe("(3 9)");
	});
});

describe("errors vs. loop signals", () => {
	it("a genuine error inside a loop body still propagates, not swallowed as a break", () => {
		expect(() => ev("(dotimes (i 3) (car 5))")).toThrow(/list expected/);
	});

	it("a try/catch inside a loop body still lets break reach the loop", () => {
		expect(
			ev(
				"(setq caught nil) (dotimes (i 3 'done) (try (break) (catch (e) (setq caught t))))",
			),
		).toBe("nil");
	});

	it("a bare top-level break surfaces as a normal, catchable EvalException", () => {
		expect(() => ev("(break)")).toThrow(/outside of a loop/);
		expect(() => ev("(return 5)")).toThrow(/outside of a loop/);
	});
});
