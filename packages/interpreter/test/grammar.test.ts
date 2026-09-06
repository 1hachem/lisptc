import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LISP_GRAMMAR } from "../src/grammar.ts";
import { accepts, parseGrammar } from "./gbnf.ts";

describe("lisptc GBNF grammar", () => {
	const g = parseGrammar(LISP_GRAMMAR);

	const valid = [
		"(+ 1 2 3 4 5)",
		"(print (fact 20))",
		"(defun adder (n) (lambda (x) (+ x n)))",
		"(< 1 2 3)",
		"(expt 2 100)",
		"'((alice .30) (bob .25) (carol .35))",
		"`(cond ((not ,test) ,@body))",
		'(load-mcp :name "fs" :command "npx" :args \'("-y" "/tmp"))',
		'(fs/echo :message "hello from lisptc")',
		'(princ "a string with \\" an escaped quote")',
		"(setq x 1)\n(print x)",
		"'(1 . 2)",
		"(print -3.5e10)",
		"Here we go: (+ 1 2) and that is the answer.",
		"First define it.\n(defun sq (x) (* x x))\nThen use it: (sq 5)",
		"the list is '(1 2 3)",
		"3 > 2, so (+ 1 2)",
		"thinking out loud (+ 1 2)",
		"just prose, no form at all",
		"the answer is 42",
		"nil",
		"t",
		"",
		'"unterminated',
		"'",
	];
	it.each(valid)("accepts %j", (src) => {
		expect(accepts(g, src)).toBe(true);
	});

	const invalid = [
		"(",
		")",
		"(+ 1 2",
		"foo)",
		"(a . )",
		"(+ 1 2) happy to help :)",
		"<|channel>thought\nlet me see\n<channel|>(+ 1 2)",
		"<|channel>thought\n(car xs)\n<channel|>(+ 1 2)",
		"(+ 1 2)<channel|>",
		"<think>let me see</think>(+ 1 2)",
		"(+ 1 2)</think>",
		"<|start|>assistant<|channel|>analysis<|message|>(+ 1 2)",
		"[THINK]let me see[/THINK](+ 1 2)",
		"(+ 1 2)[TOOL_CALLS]",
		"a bare < in prose (+ 1 2)",
		"a bare [ in prose (+ 1 2)",
	];
	it.each(invalid)("rejects %j", (src) => {
		expect(accepts(g, src)).toBe(false);
	});
});

describe("emoji GBNF grammar (test fixture)", () => {
	const g = parseGrammar(
		readFileSync(new URL("./emoji.gbnf", import.meta.url), "utf8"),
	);

	it.each(["😀", "🚀🌟", "🎉 🎊", "👍👀🔥"])("accepts %j", (src) => {
		expect(accepts(g, src)).toBe(true);
	});

	it.each(["", "hi", "abc", "😀x", "hello 😀"])("rejects %j", (src) => {
		expect(accepts(g, src)).toBe(false);
	});
});
