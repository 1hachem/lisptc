import { describe, expect, it } from "vitest";
import { ev } from "./helpers.ts";

describe("quasiquote nested inside quasiquote", () => {
	it("keeps an inner unquote for the inner level", () => {
		expect(ev("`(1 `,(+ 1 2))")).toBe("(1 `,(+ 1 2))");
	});

	it("keeps an inner splice for the inner level", () => {
		expect(ev("(progn (setq c '(1)) `(a `(b ,@c)))")).toBe("(a `(b ,@c))");
	});
});

describe("quasiquote with an empty unquote", () => {
	it("contributes nothing to the list", () => {
		expect(ev("(quasiquote ((unquote) x))")).toBe("(x)");
	});
});

describe("quasiquote whose whole body is unquoted", () => {
	it("evaluates the unquoted form", () => {
		expect(ev("(progn (setq x 5) `,x)")).toBe("5");
	});

	it("appends an unquoted tail after an empty unquote", () => {
		expect(
			ev("(progn (setq y '(1 2)) (quasiquote ((unquote) . (unquote y))))"),
		).toBe("(1 2)");
	});
});
