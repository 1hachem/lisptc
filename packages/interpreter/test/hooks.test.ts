import { describe, expect, it } from "vitest";
import { Chain, type Middleware, noOpinion } from "../src/hooks.ts";

describe("Chain", () => {
	it("runs the base when nothing registered", () => {
		const chain = new Chain<[n: number], number>();
		expect(chain.isEmpty).toBe(true);
		expect(chain.run((n) => n * 2, 21)).toBe(42);
	});

	it("runs middlewares outermost-first, in registration order", () => {
		const trace: string[] = [];
		const chain = new Chain<[], void>();
		const record =
			(name: string): Middleware<[], void> =>
			(next) => {
				trace.push(`${name} in`);
				next();
				trace.push(`${name} out`);
			};
		chain.use(record("first"));
		chain.use(record("second"));
		chain.run(() => trace.push("base"));
		expect(trace).toEqual([
			"first in",
			"second in",
			"base",
			"second out",
			"first out",
		]);
	});

	it("short-circuits on the first answer, leaving the rest unasked", () => {
		const asked: string[] = [];
		const chain = new Chain<[], string | undefined>();
		chain.use((next) => {
			asked.push("first");
			return next();
		});
		chain.use(() => {
			asked.push("second");
			return "second answers";
		});
		chain.use(() => {
			asked.push("third");
			return "third answers";
		});
		expect(chain.run(noOpinion)).toBe("second answers");
		expect(asked).toEqual(["first", "second"]);
	});

	it("falls through to noOpinion when every middleware defers", () => {
		const chain = new Chain<[form: string], string | undefined>();
		chain.use((form, next) => next(form));
		chain.use((form, next) => next(form));
		expect(chain.run(noOpinion, "(+ 1 2)")).toBeUndefined();
		expect(chain.isEmpty).toBe(false);
	});

	it("lets a middleware transform arguments and results", () => {
		const chain = new Chain<[n: number], number>();
		chain.use((n, next) => next(n + 1) * 10);
		expect(chain.run((n) => n, 4)).toBe(50);
	});
});
