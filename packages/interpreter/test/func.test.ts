import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EvalException, LoopSignal, StepHold } from "../src/errors.ts";
import { callableArity, callableKind, KeywordException } from "../src/func.ts";
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
		const evalEx = new EvalException("inner", null);
		expect(await rejectionOf(evalEx)).toBe(evalEx);
		expect(await rejectionOf(new LoopSignal(1))).toMatchObject({
			message: expect.stringMatching(/outside of a loop/),
		});
		const hold = new StepHold("wait");
		expect(await rejectionOf(hold)).toBe(hold);
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
		expect(() => runSync(interp, "(keyed :b 1)")).toThrow(
			/no such keyword argument: :b/,
		);
		try {
			runSync(interp, "(keyed :b 1)");
		} catch (ex) {
			expect(ex).toBeInstanceOf(KeywordException);
			expect((ex as KeywordException).accepted).toEqual(["a"]);
		}
	});
});

describe("reading a callable's kind and arity", () => {
	const interp = freshInterp();
	runSync(
		interp,
		"(defun fixed (a b) a) (defun rest (a &rest more) a) (defmacro mac (x) x)",
	);
	const get = (name: string) => interp.getGlobal(newSym(name));

	it("tells a macro from a function from anything else", () => {
		expect(callableKind(get("mac"))).toBe("macro");
		expect(callableKind(get("fixed"))).toBe("function");
		expect(callableKind(get("car"))).toBe("function");
		expect(callableKind(42)).toBeUndefined();
	});

	it("reports a fixed arity and an open one", () => {
		expect(callableArity(get("fixed"))).toEqual({ min: 2, max: 2 });
		expect(callableArity(get("rest"))).toEqual({ min: 1, max: undefined });
		expect(callableArity("not callable")).toBeUndefined();
	});
});
