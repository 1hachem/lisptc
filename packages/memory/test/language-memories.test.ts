import { boot, Interp, runSync } from "@repo/interpreter/lisp";
import { Cell, type List, listToArray } from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import { LANGUAGE_REFERENCE } from "@repo/interpreter/source";
import { describe, expect, it } from "vitest";
import { memoryExtension } from "../src/memory.ts";
import { memoryHost } from "../src/memory-host.ts";
import { VolatileStore } from "../src/ports.ts";

function freshInterp(): Interp {
	const interp = new Interp();
	boot(interp);
	return interp;
}

function ev(source: string, interp: Interp = freshInterp()): string {
	return str(runSync(interp, source));
}

function shippedBodies(): string {
	const interp = new Interp({
		extensions: [
			memoryExtension({ ...memoryHost, store: new VolatileStore() }),
		],
	});
	boot(interp);
	const forms = runSync(interp, "(memory/_every)");
	return (forms instanceof Cell ? listToArray(forms) : [])
		.map((form) => listToArray(form as List)[3])
		.join("\n");
}

const LANGUAGE_TEXT = `${LANGUAGE_REFERENCE}\n${shippedBodies()}`;

describe("the language reference", () => {
	it("documents multiplication", () => {
		expect(LANGUAGE_TEXT).toContain("(* n...) product, 1 if none");
	});

	it.each([
		["(* 2 3)", "6"],
		["(* 2 3.0)", "6.0"],
	])("shows %s is %s, and it is", (form, value) => {
		expect(LANGUAGE_TEXT).toContain(`${form} is ${value}`);
		expect(ev(form)).toBe(value);
	});

	it("shows a mapcar that squares", () => {
		const form = "(mapcar (lambda (n) (* n n)) '(1 2 3))";
		expect(LANGUAGE_TEXT).toContain(`${form} gives (1 4 9)`);
		expect(ev(form)).toBe("(1 4 9)");
	});

	it.each([
		[`(get-in '(:theme (:accent "red")) :theme :accent)`, '"red"'],
		[
			`(set-in '(:theme (:accent "red")) "blue" :theme :accent)`,
			'(:theme (:accent "blue"))',
		],
		["(update-in '(:n 1) (lambda (n) (+ n 1)) :n)", "(:n 2)"],
		["(remove-in '(:a 1 :b 2) :a)", "(:b 2)"],
	])("shows %s gives %s, and it does", (form, value) => {
		expect(LANGUAGE_TEXT).toContain(`${form} gives ${value}`);
		expect(ev(form)).toBe(value);
	});

	it("names let* as the sequential binding", () => {
		expect(LANGUAGE_TEXT).toContain(
			"(let* ((name val) ...) body...) sequential",
		);
		expect(ev("(let* ((a 1) (b (+ a 1))) b)")).toBe("2");
	});

	it("names the earmuffed globals that exist", () => {
		expect(LANGUAGE_TEXT).toContain("Globals: *gensym-counter*, *version*.");
		expect(() => ev("*gensym-counter*")).not.toThrow();
		expect(() => ev("*version*")).not.toThrow();
	});

	it("shows a swap that quasiquotes a gensym temporary", () => {
		const swap =
			"(defmacro swap (a b)\n  (let ((tmp (gensym)))\n    `(let ((,tmp ,a)) (setq ,a ,b) (setq ,b ,tmp))))";
		expect(LANGUAGE_TEXT).toContain(swap);
		const interp = freshInterp();
		runSync(interp, swap);
		expect(ev("(let ((x 1) (y 2)) (swap x y) (list x y))", interp)).toBe(
			"(2 1)",
		);
		expect(ev("(let ((tmp 1) (x 2)) (swap tmp x) (list tmp x))", interp)).toBe(
			"(2 1)",
		);
	});

	it("shows a try whose handler runs", () => {
		expect(LANGUAGE_TEXT).toContain('(try\n  (error "boom")');
		expect(ev('(try (error "boom") (catch (e) (concat "failed: " e)))')).toBe(
			'"failed: boom"',
		);
	});

	it("says there is no comment syntax", () => {
		expect(LANGUAGE_TEXT).toMatch(/there is no comment syntax/i);
	});
});
