import { runSync } from "@repo/interpreter/lisp";
import { describe, expect, it } from "vitest";
import { problemsIn, unclosedIn } from "../src/check.ts";
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
		expect(admission.problems).toEqual([
			{ line: 2, message: "car: expected 1 argument, got 0" },
		]);
	});

	it("rejects a form left open, even where prose surrounds it", async () => {
		const admission = await admit("Adding them up.\n(echo (+ 1 2)");
		expect(admission.rejected).toContain(
			'line 2: unexpected end of input, this "(" is never closed',
		);
	});

	it("rejects source that does not read", async () => {
		const admission = await admit("(car '(1 2)");
		expect(admission.rejected).toContain("line 1: unexpected end of input");
	});
});

describe("unclosedIn", () => {
	it("ignores an open parenthesis that opens no form", () => {
		expect(unclosedIn("that went badly :(")).toBeUndefined();
		expect(unclosedIn("a list ( of things")).toBeUndefined();
	});
});

describe("problemsIn", () => {
	const interp = linted();
	const problems = (code: string) => problemsIn(code, interp);

	it("checks a call nested in an argument that is evaluated", () => {
		expect(problems("(list 1 (car))")).toEqual([
			{
				line: 1,
				message: "car: expected 1 argument, got 0",
				severity: "error",
			},
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

	it("checks calls inside a function body", () => {
		expect(problems("(defun f (xs) (car))")).toEqual([
			{
				line: 1,
				message: "car: expected 1 argument, got 0",
				severity: "error",
			},
		]);
	});

	it("does not check a call to a name a parameter shadows", () => {
		expect(problems("(defun f (car) (car 1 2))")).toEqual([]);
	});

	it("accepts a positional call that leaves optional keyword slots out", () => {
		const own = linted();
		runSync(own, "(defun kpi (&key label value unit) label)");
		expect(problemsIn('(kpi "x")', own)).toEqual([]);
	});

	it("does not look inside a macro's arguments", () => {
		const own = linted();
		runSync(own, "(defmacro m (&rest body) nil)");
		expect(problemsIn("(m (car))", own)).toEqual([]);
	});
});

describe("undefined arguments", () => {
	const interp = linted();
	const problems = (code: string) => problemsIn(code, interp);

	it("rejects a name nothing binds at the top level", () => {
		expect(problems("(echo pricez)")).toEqual([
			{ line: 1, message: "pricez is not defined", severity: "error" },
		]);
	});

	it("only warns inside a function body, which may run once it is bound", () => {
		expect(problems("(defun f () pricez)")).toEqual([
			{ line: 1, message: "pricez is not defined", severity: "warning" },
		]);
	});

	it("knows the names each binding form binds", () => {
		expect(problems("(let ((x 1) y) (echo x y))")).toEqual([]);
		expect(problems("(let* ((x 1) (z x)) z)")).toEqual([]);
		expect(problems("(dolist (x '(1 2)) (echo x))")).toEqual([]);
		expect(problems("(dotimes (i 3 i) (echo i))")).toEqual([]);
		expect(problems("(try (car nil) (catch (e) (echo e)))")).toEqual([]);
		expect(problems("(lambda (a &rest r) (list a r))")).toEqual([]);
		expect(problems("(defun f (a &key b) (list a b))")).toEqual([]);
	});

	it("does not let a let binding see its siblings", () => {
		expect(problems("(let ((x 1) (z x)) z)")).toEqual([
			{ line: 1, message: "x is not defined", severity: "error" },
		]);
	});

	it("trusts a name the same code sets anywhere", () => {
		expect(problems("(echo total)\n(setq total 0 other 1)")).toEqual([]);
	});

	it("leaves quoted names, keywords, literals and server tools alone", () => {
		expect(problems('(list \'pricez :k "s" 1 t nil srv/tool)')).toEqual([]);
	});

	it("never flags a head, which is read as prose", () => {
		expect(problems("(echo (totl prices))")).toEqual([]);
	});
});

describe("literal argument types", () => {
	const own = linted();
	runSync(own, "(defun fetch (&rest r) r)");
	own.setDoc("fetch", {
		signature: "(fetch :name n :limit k :tags l)",
		doc: "Fetch.",
		args: [
			{ name: "name", type: "string", required: true },
			{ name: "limit", type: "integer", required: false },
			{ name: "tags", type: "list", required: false },
		],
	});
	const problems = (code: string) => problemsIn(code, own);

	it("rejects a literal of the wrong type", () => {
		expect(problems("(fetch :name 42)")).toEqual([
			{
				line: 1,
				message: "fetch: :name takes a string, got 42",
				severity: "error",
			},
		]);
		expect(problems('(fetch :name "a" :limit 1.5 :tags "x")')).toHaveLength(2);
	});

	it("accepts the right literal, nil for an optional one, and any expression", () => {
		expect(problems('(fetch :name "a" :limit 3 :tags \'(x))')).toEqual([]);
		expect(problems('(fetch :name "a" :limit nil)')).toEqual([]);
		expect(problems('(fetch :name (car \'("a")))')).toEqual([]);
	});
});
