import { describe, expect, it } from "vitest";
import { ev, freshInterp } from "./helpers.ts";

describe("a chain of source hooks", () => {
	it("runs middlewares outermost-first, in registration order", () => {
		const interp = freshInterp();
		interp.hooks.readSource.use((i, text, next) =>
			next(i, text.replace("x", "(list 'first y)")),
		);
		interp.hooks.readSource.use((i, text, next) =>
			next(i, text.replace("y", "'second")),
		);
		expect(ev("x", interp)).toBe("(first second)");
	});

	it("short-circuits on the first answer, leaving the rest unasked", () => {
		const interp = freshInterp();
		interp.hooks.readSource.use((i, text, next) => next(i, text));
		interp.hooks.readSource.use(() => "'second");
		interp.hooks.readSource.use(() => "'third");
		expect(ev("'base", interp)).toBe("second");
	});

	it("lets a middleware transform arguments and results", () => {
		const interp = freshInterp();
		interp.hooks.readSource.use(
			(i, text, next) => `(* 10 ${next(i, `(+ 1 ${text})`)})`,
		);
		expect(ev("4", interp)).toBe("50");
	});
});
