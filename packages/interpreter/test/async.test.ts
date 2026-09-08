import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	Cell,
	type Eval,
	EvalException,
	Interp,
	prelude,
	runAsync,
	runSync,
	str,
} from "../src/lisp.ts";
import { Promises } from "../src/promises.ts";

function interpWithSlow(): Interp {
	const interp = new Interp();
	runSync(interp, prelude);
	interp.def(
		"slow",
		1,
		"(slow x)",
		"Return x after a turn of the event loop.",
		z.tuple([z.any()]),
		([x]) => new Promise((resolve) => setTimeout(() => resolve(x), 1)),
	);
	interp.defPromise(
		"boom-later",
		0,
		"(boom-later)",
		"Return a promise that rejects on the next turn of the loop.",
		z.tuple([]),
		() =>
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("nope")), 1),
			),
	);
	interp.def(
		"boom",
		0,
		"(boom)",
		"Reject after a turn of the event loop.",
		z.tuple([]),
		() => Promise.reject(new Error("no")),
	);
	return interp;
}

async function evAsync(
	code: string,
	interp = interpWithSlow(),
): Promise<string> {
	return str((await runAsync(interp, code)).value);
}

describe("a promise from a builtin suspends the evaluator", () => {
	it("resolves in an argument position", async () => {
		expect(await evAsync("(+ 1 (slow 2))")).toBe("3");
	});

	it("resolves inside a closure body", async () => {
		expect(
			await evAsync("(defun twice (x) (+ (slow x) (slow x))) (twice 21)"),
		).toBe("42");
	});

	it("resolves inside a loop that runs many times", async () => {
		expect(
			await evAsync("(let ((s 0)) (dotimes (i 5) (setq s (+ s (slow 2)))) s)"),
		).toBe("10");
	});

	it("keeps tail calls from growing the stack while suspending", async () => {
		expect(
			await evAsync(
				"(defun down (n) (if (= n 0) 'done (down (- (slow n) 1)))) (down 200)",
			),
		).toBe("done");
	});

	it("lets the event loop turn during one eval", async () => {
		let ticked = false;
		setTimeout(() => {
			ticked = true;
		}, 0);
		await evAsync("(slow 1)");
		expect(ticked).toBe(true);
	});
});

describe("a rejected promise is an ordinary Lisp error", () => {
	it("is catchable with try", async () => {
		expect(await evAsync('(try (boom) (catch (e) "caught"))')).toBe('"caught"');
	});

	it("names the builtin that failed", async () => {
		await expect(evAsync("(boom)")).rejects.toThrow(/boom/);
	});
});

describe("a suspending built-in written with defGen", () => {
	it("may yield from its own body", async () => {
		const interp = interpWithSlow();
		interp.defGen(
			"twice-slow",
			1,
			"(twice-slow x)",
			"Evaluate (slow x) twice and add the results.",
			z.tuple([z.any()]),
			function* ([x]): Eval {
				const a = (yield Promise.resolve(x)) as number;
				const b = (yield Promise.resolve(x)) as number;
				return a + b;
			},
		);
		expect(await evAsync("(twice-slow 4)", interp)).toBe("8");
	});
});

describe("runSync refuses to suspend", () => {
	it("raises rather than half-running the program", () => {
		expect(() => runSync(interpWithSlow(), "(+ 1 (slow 2))")).toThrow(
			/cannot suspend/,
		);
	});

	it("still runs everything that does not suspend", () => {
		const interp = interpWithSlow();
		expect(str(runSync(interp, "(+ 1 2)"))).toBe("3");
	});

	it("reports as a catchable EvalException", () => {
		try {
			runSync(interpWithSlow(), "(slow 1)");
			expect.unreachable();
		} catch (ex) {
			expect(ex).toBeInstanceOf(EvalException);
		}
	});
});

describe("a promise is the host's own promise", () => {
	function starter(): { interp: Interp; runs: () => number } {
		const interp = interpWithSlow();
		let runs = 0;
		const promises = new Promises(
			(op, payload) =>
				new Promise((resolve, reject) =>
					setTimeout(
						() =>
							op === "fail" ? reject(new Error("nope")) : resolve(payload),
						1,
					),
				),
			(raw) => raw,
		);
		promises.installBuiltins(interp);
		interp.defPromise(
			"start",
			1,
			"(start x)",
			"Return a promise for x.",
			z.tuple([z.any()]),
			([x]) =>
				promises.start("echo", x, (raw) => {
					runs += 1;
					return raw;
				}),
		);
		interp.defPromise(
			"start-failing",
			0,
			"(start-failing)",
			"Return a promise that rejects.",
			z.tuple([]),
			() => promises.start("fail", null),
		);
		return { interp, runs: () => runs };
	}

	it("is a real Promise the host can await", async () => {
		const interp = interpWithSlow();
		const { value } = await runAsync(interp, "(list (slow 1))");
		expect(value).toBeInstanceOf(Cell);
		expect((value as Cell).car).toBe(1n);
	});

	it("does not suspend when the promise is the value", () => {
		const { interp } = starter();
		expect(str(runSync(interp, "(start 7)"))).toBe("#<promise>");
	});

	it("applies its result once, however many times it is awaited", async () => {
		const { interp, runs } = starter();
		expect(
			await evAsync("(setq p (start 7)) (await p) (await p)", interp),
		).toBe("7");
		expect(runs()).toBe(1);
	});

	it("keeps its value with no cache of ours", async () => {
		const { interp } = starter();
		await evAsync("(setq p (start 7))", interp);
		expect(await evAsync("(promise-state p)", interp)).toBe(":pending");
		expect(await evAsync("(await p)", interp)).toBe("7");
		expect(await evAsync("(promise-state p)", interp)).toBe(":fulfilled");
		expect(await evAsync("(await p)", interp)).toBe("7");
	});

	it("applies its result with no await at all", async () => {
		const { interp, runs } = starter();
		await evAsync("(start 7)", interp);
		await evAsync("(slow 1)", interp);
		expect(runs()).toBe(1);
	});

	it("drops a settled promise from (promises)", async () => {
		const { interp } = starter();
		await evAsync("(setq p (start 7))", interp);
		expect(await evAsync("(length (promises))", interp)).toBe("1");
		await evAsync("(await p)", interp);
		expect(await evAsync("(length (promises))", interp)).toBe("0");
	});

	it("combines the way the host combines", async () => {
		const { interp } = starter();
		expect(
			await evAsync("(await (promise-all (list (start 1) (start 2))))", interp),
		).toBe("(1 2)");
		expect(
			await evAsync("(await (promise-race (list (start 1))))", interp),
		).toBe("1");
		expect(
			await evAsync(
				"(await (promise-any (list (start-failing) (start 9))))",
				interp,
			),
		).toBe("9");
		expect(
			await evAsync(
				"(await (promise-all-settled (list (start 1) (start-failing))))",
				interp,
			),
		).toContain(":rejected");
	});
});
