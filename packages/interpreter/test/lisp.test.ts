import { describe, expect, it } from "vitest";
import { z } from "zod";
import { driveSync } from "../src/drive.ts";
import {
	boot,
	type Installable,
	Interp,
	runAsync,
	runSync,
} from "../src/lisp.ts";
import { Cell, Keyword, newSym } from "../src/objects.ts";
import { str } from "../src/print.ts";
import { LANGUAGE_REFERENCE } from "../src/source.ts";
import { ev, evAsync, freshInterp, withSettle } from "./helpers.ts";

describe("arityOf", () => {
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
	it("installs each extension in order and appends the prompts it carries", () => {
		const first: Installable = Object.assign(
			(interp: Interp) => interp.defineGlobal(newSym("ext-value"), 1n),
			{ prompt: "extension prompt" },
		);
		const second: Installable = (interp: Interp) =>
			interp.defineGlobal(newSym("ext-value"), 2n);
		const interp = freshInterp({ extensions: [first, second] });
		expect(ev("ext-value", interp)).toBe("2");
		expect(interp.systemPrompt()).toBe(
			`${LANGUAGE_REFERENCE}\n\nextension prompt`,
		);
	});

	it("says it has booted only once every postlude has run", () => {
		const seen: Installable = Object.assign(() => {}, {
			postlude: "(setq during *booted*)",
		});
		const interp = new Interp({ extensions: [seen] });
		expect(ev("*booted*", interp)).toBe("nil");
		boot(interp);
		expect(ev("(list during *booted*)", interp)).toBe("(nil t)");
		expect(() => ev("(setq *booted* nil)", interp)).toThrow(/owned by boot/);
	});

	it("counts as booted even when a postlude fails", () => {
		const broken: Installable = Object.assign(() => {}, {
			postlude: "(no-such-form)",
		});
		const interp = new Interp({ extensions: [broken] });
		expect(() => boot(interp)).toThrow(/no-such-form/);
		expect(ev("*booted*", interp)).toBe("t");
	});

	it("boots every extension's prelude before any extension's postlude", () => {
		const first: Installable = Object.assign(() => {}, {
			prelude: "(setq order nil) (defun note (x) (setq order (cons x order)))",
			postlude: '(note "first postlude")',
		});
		const second: Installable = Object.assign(() => {}, {
			prelude: '(note "second prelude")',
			postlude: '(note "second postlude")',
		});
		const interp = freshInterp({ extensions: [first, second] });
		expect(ev("(reverse order)", interp)).toBe(
			'("second prelude" "first postlude" "second postlude")',
		);
	});
});

describe("builtin kinds", () => {
	it("hands back the promise a promise builtin returns, unsettled", async () => {
		const interp = withSettle(freshInterp());
		interp.defPromise(
			"later",
			1,
			"(later x)",
			"Resolve to `x`.",
			z.tuple([z.unknown()]),
			async ([x]) => x,
		);
		expect(await evAsync("(later 5)", interp)).toBe("#<promise>");
		expect(await evAsync("(settle (later 5))", interp)).toBe("5");
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
		const lines = (code: string) => {
			try {
				runSync(interp, code);
			} catch (ex) {
				return String(ex).split("\n").length;
			}
			throw new Error(`${code} did not fail`);
		};
		expect(lines("(deep 200)")).toBe(lines("(deep 20)"));
		expect(lines("(deep 20)")).toBeLessThan(20);
	});
});

describe("runAsync", () => {
	it("resolves to the value of the last form", async () => {
		const { value } = await runAsync(freshInterp(), "(+ 1 2) (list 3 4)");
		expect(str(value)).toBe("(3 4)");
	});
});

describe("reading through the interpreter", () => {
	it("reads one form, every form, or why the text does not read", () => {
		const interp = freshInterp();
		expect(str(interp.read('(a "b\nc") (d)'))).toBe('(a "b\\nc")');
		expect(interp.readAll("(a) b 3").map((form) => str(form))).toEqual([
			"(a)",
			"b",
			"3",
		]);
		expect(() => interp.read("(a")).toThrow(/unclosed/);
		expect(interp.readFailure("(a")?.reason).toBe("unexpected end of input");
		expect(interp.readFailure("(a)")).toBeUndefined();
	});
});
