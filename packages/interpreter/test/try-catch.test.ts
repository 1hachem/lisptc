import { describe, expect, it } from "vitest";
import { ev } from "./helpers.ts";

describe("try / catch", () => {
	it("returns the body's value when no error is signalled", () => {
		expect(ev("(try 1 (catch (e) 2))")).toBe("1");
	});

	it("binds the handler variable to a built-in error's value", () => {
		expect(ev("(try no-such-var (catch (e) (eq e 'no-such-var)))")).toBe("t");
	});

	it("binds the handler variable to a user (error value) exactly", () => {
		expect(ev("(try (error '(1 2 3)) (catch (e) e))")).toBe("(1 2 3)");
		expect(ev("(try (error 42) (catch (e) e))")).toBe("42");
		expect(ev('(try (error "boom") (catch (e) e))')).toBe('"boom"');
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
				"(try (try (error 'inner) (catch (e) (error (list 'rethrown e)))) (catch (e) e))",
			),
		).toBe("(rethrown inner)");
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
