import { describe, expect, it } from "vitest";
import { ev } from "./helpers.ts";

describe("try / catch", () => {
	it("returns the body's value when no error is signalled", () => {
		expect(ev("(try 1 (catch (e) 2))")).toBe("1");
	});

	it("binds a built-in error's kind and offending value", () => {
		expect(
			ev(
				"(try no-such-var (catch (e) (list (get-in e :kind) (get-in e :value))))",
			),
		).toBe("(:void-variable no-such-var)");
		expect(ev("(try (car 1) (catch (e) (get-in e :kind)))")).toBe(
			":type-error",
		);
		expect(ev("(try (no-such-fn 1) (catch (e) (get-in e :kind)))")).toBe(
			":undefined-function",
		);
	});

	it("binds a user error as kind, message and value", () => {
		expect(ev('(try (error "boom") (catch (e) e))')).toBe(
			'(:kind :error :message "boom" :value "boom")',
		);
		expect(ev('(try (error :not-found "no file" "/x") (catch (e) e))')).toBe(
			'(:kind :not-found :message "no file" :value "/x")',
		);
		expect(ev("(try (error '(1 2 3)) (catch (e) (get-in e :value)))")).toBe(
			"(1 2 3)",
		);
	});

	it("an inner try that handles its own error does not leak to an outer catch", () => {
		expect(
			ev(
				"(try (try (error 'inner) (catch (e) 'handled-inner)) (catch (e) 'handled-outer))",
			),
		).toBe("handled-inner");
	});

	it("an outer try catches what an inner try rethrows", () => {
		expect(
			ev(
				"(try (try (error 'inner) (catch (e) (error (list 'rethrown (get-in e :value))))) (catch (e) (get-in e :value)))",
			),
		).toBe("(rethrown inner)");
	});

	it("re-raises a caught error unchanged", () => {
		expect(
			ev(
				"(try (try (no-such-fn) (catch (e) (error e))) (catch (e) (get-in e :kind)))",
			),
		).toBe(":undefined-function");
	});

	it("runs the first catch whose kind matches", () => {
		expect(
			ev(
				"(try (error :b \"x\") (catch :a (e) 'a) (catch (:c :b) (e) 'b-or-c) (catch (e) 'any))",
			),
		).toBe("b-or-c");
		expect(
			ev("(try (error :z \"x\") (catch :a (e) 'a) (catch (e) 'any))"),
		).toBe("any");
	});

	it("lets an error no catch matches propagate", () => {
		expect(
			ev(
				"(try (try (error :z \"x\") (catch :a (e) 'inner)) (catch :z (e) 'outer))",
			),
		).toBe("outer");
	});

	it("evaluates every body form and returns the last", () => {
		expect(ev("(let ((n 0)) (try (setq n 1) (+ n 1) (catch (e) 'no)))")).toBe(
			"2",
		);
	});

	it("runs finally however the try exits", () => {
		expect(
			ev(
				"(let ((log nil)) (list (try 1 (finally (push 'ok log))) (try (car 1) (catch (e) 'caught) (finally (push 'err log))) log))",
			),
		).toBe("(1 caught (err ok))");
	});

	it("does not catch loop signals or throws as errors", () => {
		expect(
			ev(
				"(dotimes (i 3 'done) (try (if (= i 1) (return 'out)) (catch (e) 'no)))",
			),
		).toBe("out");
	});

	it("retries a failing form at most n more times", () => {
		expect(
			ev(
				'(let ((n 0)) (retry 5 (progn (setq n (+ n 1)) (if (< n 3) (error :flaky "f") n))))',
			),
		).toBe("3");
		expect(
			ev(
				'(let ((n 0)) (try (retry 2 (progn (setq n (+ n 1)) (error :flaky "f"))) (catch (e) n)))',
			),
		).toBe("3");
	});

	it("retries only the kinds named by :on", () => {
		expect(
			ev(
				'(let ((n 0)) (try (retry 3 (progn (setq n (+ n 1)) (error :bad "f")) :on :flaky) (catch (e) (list n (get-in e :kind)))))',
			),
		).toBe("(1 :bad)");
	});

	it("turns an error into an (:error e) value with attempt", () => {
		expect(
			ev("(mapcar (lambda (x) (car (attempt (car x)))) '((1) 2 (3)))"),
		).toBe("(:ok :error :ok)");
		expect(ev("(attempt (+ 1 2))")).toBe("(:ok 3)");
	});

	it("chains results with with-ok and stops at the first error", () => {
		expect(
			ev("(with-ok ((a (attempt 2)) (b (attempt (* a 3)))) (+ a b))"),
		).toBe("(:ok 8)");
		expect(
			ev(
				"(let ((n 0)) (list (car (with-ok ((a (attempt (car 1))) (b (attempt (setq n 1)))) b)) n))",
			),
		).toBe("(:error 0)");
	});

	it("does not misexpand a catch variable that shadows an existing macro name", () => {
		expect(ev("(defun f () (try 1 (catch (or) or))) (f)")).toBe("1");
	});

	it("does not overflow the stack when wrapping a large loop", () => {
		expect(ev("(try (dotimes (i 100000) nil) (catch (e) e))")).toBe("nil");
	});

	it("does not catch a break/return loop signal", () => {
		expect(
			ev(
				"(setq caught nil) (dotimes (i 3) (try (break) (catch (e) (setq caught t)))) caught",
			),
		).toBe("nil");
	});
});
