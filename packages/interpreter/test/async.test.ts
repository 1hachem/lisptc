import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	type Eval,
	EvalException,
	Interp,
	prelude,
	runAsync,
	runSync,
	str,
} from "../src/lisp.ts";

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
	return str(await runAsync(interp, code));
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
