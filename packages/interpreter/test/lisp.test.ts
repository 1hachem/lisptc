import { describe, expect, it } from "vitest";
import { z } from "zod";
import { driveSync } from "../src/drive.ts";
import { EvalException } from "../src/errors.ts";
import {
	type Installable,
	type Interp,
	runAsync,
	runSync,
} from "../src/lisp.ts";
import { Cell, Keyword, newSym } from "../src/objects.ts";
import { str } from "../src/print.ts";
import { LANGUAGE_REFERENCE } from "../src/source.ts";
import { ev, freshInterp } from "./helpers.ts";

describe("arityOf", () => {
	it("reads the arity of a builtin", () => {
		expect(freshInterp().arityOf("car")).toEqual({ min: 1, max: 1 });
	});

	it("leaves the maximum open for a rest parameter", () => {
		const interp = freshInterp();
		runSync(interp, "(setq f (lambda (a &rest r) a))");
		expect(interp.arityOf("f")).toEqual({ min: 1, max: undefined });
	});

	it("is undefined for a name that holds no function", () => {
		const interp = freshInterp();
		runSync(interp, "(setq n 1)");
		expect(interp.arityOf("n")).toBeUndefined();
		expect(interp.arityOf("no-such-name")).toBeUndefined();
	});
});

describe("extensions", () => {
	it("installs each extension and appends the prompts it carries", () => {
		const installed: string[] = [];
		const withPrompt: Installable = Object.assign(
			(interp: Interp) => {
				installed.push("with");
				interp.defineGlobal(newSym("ext-value"), 42n);
			},
			{ prompt: "extension prompt" },
		);
		const withoutPrompt: Installable = () => {
			installed.push("without");
		};
		const interp = freshInterp({ extensions: [withPrompt, withoutPrompt] });
		expect(installed).toEqual(["with", "without"]);
		expect(ev("ext-value", interp)).toBe("42");
		expect(interp.systemPrompt()).toBe(
			`${LANGUAGE_REFERENCE}\n\nextension prompt`,
		);
	});

	it("carries only the language reference with no extension", () => {
		expect(freshInterp().systemPrompt()).toBe(LANGUAGE_REFERENCE);
	});
});

describe("builtin kinds", () => {
	it("watches the promise a promise builtin returns", async () => {
		const interp = freshInterp();
		interp.defPromise(
			"later",
			1,
			"(later x)",
			"Resolve to `x`.",
			z.tuple([z.unknown()]),
			async ([x]) => x,
		);
		const { value } = await runAsync(interp, "(later 5)");
		expect(value).toBeInstanceOf(Promise);
		expect(await value).toBe(5n);
		expect(interp.async.stateOf(value as Promise<unknown>)).toBe("fulfilled");
		expect(interp.docs().get("later")?.signature).toBe("(later x)");
	});

	it("settles the promise a plain builtin returns", async () => {
		const interp = freshInterp();
		interp.def(
			"slow-double",
			1,
			"(slow-double n)",
			"Double `n`, eventually.",
			z.tuple([z.bigint()]),
			async ([n]) => n * 2n,
		);
		const { value } = await runAsync(interp, "(+ 1 (slow-double 4))");
		expect(value).toBe(9n);
	});

	it("wraps a body handed to makeBuiltIn", () => {
		const interp = freshInterp();
		interp.defineGlobal(
			newSym("twice"),
			interp.makeBuiltIn("twice", 1, ([x]) => [x, x]),
		);
		expect(runSync(interp, "(twice 3)")).toEqual([3n, 3n]);
	});
});

describe("call guard", () => {
	it("names the builtin it is about to call", () => {
		const interp = freshInterp();
		const calls: string[] = [];
		interp.hooks.call.use((i, name, args, next) => {
			calls.push(name);
			next(i, name, args);
		});
		runSync(interp, "(car '(1))");
		expect(calls).toContain("car");
	});
});

describe("globals", () => {
	it("reports whether a global is bound and lists every entry", () => {
		const interp = freshInterp();
		const sym = newSym("bound-here");
		expect(interp.hasGlobal(sym)).toBe(false);
		runSync(interp, "(setq bound-here 7)");
		expect(interp.hasGlobal(sym)).toBe(true);
		expect(new Map(interp.globalEntries()).get(sym)).toBe(7n);
	});
});

describe("dispose", () => {
	it("aborts the work still running", () => {
		const interp = freshInterp();
		let aborted = false;
		interp.async.start(
			(signal) =>
				new Promise(() => {
					signal.addEventListener("abort", () => {
						aborted = true;
					});
				}),
		);
		interp.dispose();
		expect(aborted).toBe(true);
		expect(interp.async.pending()).toEqual([]);
	});
});

describe("malformed special forms", () => {
	it("rejects a quasiquote with more than one argument", () => {
		expect(() => ev("(quasiquote 1 2)")).toThrow("bad quasiquote");
	});

	it("rejects a keyword the evaluator does not know", () => {
		const interp = freshInterp();
		const form = new Cell(new Keyword("bogus-keyword"), null);
		expect(() => driveSync(interp.evalGen(form, null))).toThrow("bad keyword");
	});

	it("rejects a cond clause that is not a list", () => {
		expect(() => ev("(cond 1)")).toThrow("cond test expected");
	});

	it("skips a nil cond clause", () => {
		expect(ev("(cond () (t 2))")).toBe("2");
	});

	it("rejects a catch clause binding more than one variable", () => {
		expect(() => ev("(try 1 (catch (a b) 2))")).toThrow(
			"try: catch expects exactly one variable",
		);
	});

	it("rejects a malformed try", () => {
		expect(() => ev("(try)")).toThrow("bad try");
		expect(() => ev("(try 1)")).toThrow(
			"try: exactly one catch clause expected",
		);
		expect(() => ev("(try 1 2)")).toThrow("try: catch clause expected");
		expect(() => ev("(try 1 (catch))")).toThrow("try: catch variable expected");
	});

	it("rejects a macro defined inside a function body", () => {
		expect(() => ev("((lambda () (macro (x) x)))")).toThrow("nested macro");
	});

	it("rejects a macro form a closure only meets at run time", () => {
		const interp = freshInterp();
		runSync(interp, "(setq late-caller (lambda () (late-macro)))");
		runSync(interp, "(setq late-macro (macro () '(macro (x) x)))");
		expect(() => runSync(interp, "(late-caller)")).toThrow("nested macro");
	});

	it("rejects a setq missing its value", () => {
		expect(() => ev("(setq a)")).toThrow("right value expected");
	});

	it("rejects an unbound symbol in argument position", () => {
		expect(() => ev("(list unbound-in-arg)")).toThrow("unbound-in-arg");
	});

	it("keeps the trace of a deep failure bounded", () => {
		const interp = freshInterp();
		runSync(
			interp,
			"(setq deep (lambda (n) (cond ((= n 0) (car 1)) (t (+ 1 (deep (- n 1)))))))",
		);
		try {
			runSync(interp, "(deep 20)");
			expect.unreachable();
		} catch (ex) {
			expect(ex).toBeInstanceOf(EvalException);
			expect((ex as EvalException).trace.length).toBe(10);
		}
	});
});

describe("runAsync", () => {
	it("resolves to the value of the last form", async () => {
		const { value } = await runAsync(freshInterp(), "(+ 1 2) (list 3 4)");
		expect(str(value)).toBe("(3 4)");
	});
});
