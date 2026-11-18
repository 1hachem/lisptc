import { describe, expect, it } from "vitest";
import { EvalException } from "../src/errors.ts";
import { type Interp, runSync } from "../src/lisp.ts";
import { str } from "../src/print.ts";
import { ev, freshInterp } from "./helpers.ts";

function recording(): { interp: Interp; seen: string[] } {
	const interp = freshInterp();
	const seen: string[] = [];
	interp.hooks.call.use((_interp, name, _args, next) => {
		seen.push(name);
		next(_interp, name, _args);
	});
	return { interp, seen };
}

function refusing(banned: string): Interp {
	const interp = freshInterp();
	interp.hooks.call.use((i, name, args, next) => {
		if (name === banned) throw new EvalException("refused", name, false);
		next(i, name, args);
	});
	return interp;
}

describe("the call guard", () => {
	it("leaves evaluation unchanged when nothing hooks it", () => {
		expect(ev("(+ 1 2)")).toBe("3");
	});

	it("refuses a builtin reached through apply and through a higher-order function", () => {
		expect(() => runSync(refusing("+"), "(apply + '(1 2))")).toThrow("refused");
		expect(() => runSync(refusing("car"), "(mapcar car '((1) (2)))")).toThrow(
			"refused",
		);
	});

	it("names a builtin by what it is, not by the symbol it was rebound to", () => {
		const { interp, seen } = recording();
		runSync(interp, "(setq kar car) (kar '(1))");
		expect(seen).toContain("car");
	});

	it("refuses special forms and macros by name", () => {
		expect(() => runSync(refusing("defun"), "(defun f (x) x)")).toThrow(
			"refused",
		);
		expect(() => runSync(refusing("cond"), "(cond (t 1))")).toThrow("refused");
	});

	it("refuses a call by throwing, and the refusal reaches the caller", () => {
		const interp = refusing("car");
		expect(() => runSync(interp, "(list (car '(1)))")).toThrow("refused");
		expect(str(runSync(interp, "(cdr '(1 2))"))).toBe("(2)");
	});
});
