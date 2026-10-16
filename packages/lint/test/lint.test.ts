import { runSync } from "@repo/interpreter/lisp";
import { describe, expect, it } from "vitest";
import { problemsIn } from "../src/check.ts";
import { admit, linted } from "./helpers.ts";

describe("admit", () => {
	it("admits clean code unchanged", async () => {
		expect(await admit("(car '(1 2))")).toEqual({ code: "(car '(1 2))" });
	});

	it("rejects a call with the wrong arity and says where", async () => {
		const admission = await admit("(setq xs '(1 2))\n(car)");
		expect(admission.code).toBe("(setq xs '(1 2))\n(car)");
		expect(admission.rejected).toContain(
			"line 2: car: expected 1 argument, got 0",
		);
	});

	it("rejects source that does not read", async () => {
		const admission = await admit("(car '(1 2)");
		expect(admission.rejected).toContain("line 1: unexpected end of input");
	});
});

describe("problemsIn", () => {
	const interp = linted();
	const problems = (code: string) => problemsIn(code, interp);

	it("checks a call nested in an argument that is evaluated", () => {
		expect(problems("(list 1 (car))")).toEqual([
			{ line: 1, message: "car: expected 1 argument, got 0" },
		]);
	});

	it("checks inside the forms that evaluate every argument", () => {
		expect(problems("(when t (car))")).toHaveLength(1);
		expect(problems("(progn (car))")).toHaveLength(1);
		expect(problems("(if t (car) nil)")).toHaveLength(1);
	});

	it("never reads quoted data as a call", () => {
		expect(problems("(list '(car) `(cdr))")).toEqual([]);
	});

	it("never reads a parameter or binding list as a call", () => {
		expect(problems("(defun f (car) car)")).toEqual([]);
		expect(problems("(let ((car 1)) car)")).toEqual([]);
		expect(problems("(lambda (car) car)")).toEqual([]);
	});

	it("does not flag a head nothing defines, which is read as prose", () => {
		expect(problems("(totl prices)")).toEqual([]);
	});

	it("trusts a name the same code defines over its current arity", () => {
		const own = linted();
		runSync(own, "(defun g (a) a)");
		expect(problemsIn("(defun g (a b) a)\n(g 1 2)", own)).toEqual([]);
		expect(problemsIn("(g 1 2)", own)).toHaveLength(1);
	});

	it("does not look inside a macro's arguments", () => {
		const own = linted();
		runSync(own, "(defmacro m (&rest body) nil)");
		expect(problemsIn("(m (car))", own)).toEqual([]);
	});
});
