import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EvalException, LoopSignal, StepHold } from "../src/errors.ts";
import { KeywordException } from "../src/func.ts";
import { runAsync, runSync } from "../src/lisp.ts";
import { newSym } from "../src/objects.ts";
import { str } from "../src/print.ts";
import { freshInterp } from "./helpers.ts";

function withRejecting(reason: unknown) {
	const interp = freshInterp();
	interp.def("reject", 0, "(reject)", "", z.tuple([]), () =>
		Promise.reject(reason),
	);
	interp.def("resolve", 1, "(resolve x)", "", z.tuple([z.any()]), ([x]) =>
		Promise.resolve(x),
	);
	return interp;
}

async function rejectionOf(reason: unknown): Promise<unknown> {
	try {
		await runAsync(withRejecting(reason), "(reject)");
	} catch (ex) {
		return ex;
	}
	throw new Error("(reject) did not throw");
}

describe("a macro value", () => {
	it("prints as a macro with its arity and body", () => {
		const interp = freshInterp();
		runSync(interp, "(defmacro twice (x) (list 'progn x x))");
		expect(String(interp.getGlobal(newSym("twice")))).toMatch(/^#<macro:1:/);
	});
});

describe("a plain builtin that returns a promise", () => {
	it("settles to the resolved value under the async driver", async () => {
		const { value } = await runAsync(withRejecting(null), "(resolve 7)");
		expect(str(value)).toBe("7");
	});

	it("names itself in the failure when the promise rejects with an Error", async () => {
		const ex = await rejectionOf(new Error("boom"));
		expect(ex).toBeInstanceOf(EvalException);
		expect((ex as Error).message).toMatch(/reject failed/);
		expect((ex as Error).message).toMatch(/boom/);
	});

	it("stringifies a rejection that is not an Error", async () => {
		const ex = await rejectionOf("plain reason");
		expect(ex).toBeInstanceOf(EvalException);
		expect((ex as Error).message).toMatch(/plain reason/);
	});

	it("passes an evaluator exception, a loop signal and a held step through", async () => {
		const inner = await rejectionOf(new EvalException("inner", null));
		expect((inner as Error).message).toMatch(/^inner/);
		expect((inner as Error).message).not.toMatch(/reject failed/);
		expect(String(await rejectionOf(new LoopSignal(1)))).toMatch(
			/outside of a loop/,
		);
		expect(await rejectionOf(new StepHold("wait"))).toBeInstanceOf(StepHold);
	});
});

describe("a builtin with keyword arguments", () => {
	it("names itself when refusing a keyword it does not accept", () => {
		const interp = freshInterp();
		interp.def(
			"keyed",
			1,
			"(keyed &key a)",
			"",
			z.tuple([z.any()]),
			([a]) => a,
			undefined,
			["a"],
		);
		const refused = (() => {
			try {
				runSync(interp, "(keyed :b 1)");
			} catch (ex) {
				return ex;
			}
		})();
		expect(refused).toBeInstanceOf(KeywordException);
		expect((refused as KeywordException).accepted).toEqual(["a"]);
	});
});
