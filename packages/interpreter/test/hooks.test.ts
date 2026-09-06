import { describe, expect, it } from "vitest";
import { Chain, type Middleware, noOpinion } from "../src/hooks.ts";

// The combinator every extension point is built from (src/hooks.ts). Its two
// load-bearing properties are the order middlewares run in and what happens
// when nobody answers, so those are what is pinned here.
describe("Chain", () => {
	it("runs the base when nothing registered", () => {
		const chain = new Chain<[n: number], number>();
		expect(chain.isEmpty).toBe(true);
		expect(chain.run((n) => n * 2, 21)).toBe(42);
	});

	// Registration order is outermost-first, matching the left-to-right reading
	// of `InterpOptions.extensions`: the first extension registered sees a value
	// before the later ones do, and its work wraps theirs.
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

	// A veto chain: the first middleware to answer wins, and one that defers
	// with next() never sees the later answer attributed to it.
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

	// Deferring all the way down reaches the base, which is how "nobody
	// objected" is spelled for every veto hook in the core.
	it("falls through to noOpinion when every middleware defers", () => {
		const chain = new Chain<[form: string], string | undefined>();
		chain.use((form, next) => next(form));
		chain.use((form, next) => next(form));
		expect(chain.run(noOpinion, "(+ 1 2)")).toBeUndefined();
		expect(chain.isEmpty).toBe(false);
	});

	// A wrapping chain, the shape `evalForm` will use: middlewares may rewrite
	// what reaches the base and what comes back out of it.
	it("lets a middleware transform arguments and results", () => {
		const chain = new Chain<[n: number], number>();
		chain.use((n, next) => next(n + 1) * 10);
		expect(chain.run((n) => n, 4)).toBe(50);
	});
});
