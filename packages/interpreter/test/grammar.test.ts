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
		// Prose around the forms is free text the interpreter ignores.
		"Here we go: (+ 1 2) and that is the answer.",
		"First define it.\n(defun sq (x) (* x x))\nThen use it: (sq 5)",
		"the list is '(1 2 3)",
		// ">" is still ordinary prose — only "<" is fenced out.
		"3 > 2, so (+ 1 2)",
		"thinking out loud (+ 1 2)",
		// A form-less reply is how the agent ends the loop, so it has to be
		// sayable under the grammar.
		"just prose, no form at all",
		"the answer is 42",
		"nil",
		"t",
		"",
	];
	it.each(valid)("accepts %j", (src) => {
		expect(accepts(g, src)).toBe(true);
	});

	const invalid = [
		"(", // unbalanced
		")", // stray close
		"(+ 1 2", // unterminated list
		"foo)", // trailing close
		'"unterminated', // open string
		"'", // quote with nothing to quote
		"(a . )", // dotted pair with no tail
		"(+ 1 2) happy to help :)", // a stray close paren, even in prose
		// No model may open a thinking channel or any other control tag. Every
		// family brackets them with "<" or "[", and both are fenced out of prose.
		"<|channel>thought\nlet me see\n<channel|>(+ 1 2)", // gemma-4
		"<|channel>thought\n(car xs)\n<channel|>(+ 1 2)",
		"(+ 1 2)<channel|>",
		"<think>let me see</think>(+ 1 2)", // deepseek, qwen, seed-oss
		"(+ 1 2)</think>",
		"<|start|>assistant<|channel|>analysis<|message|>(+ 1 2)", // gpt-oss
		"[THINK]let me see[/THINK](+ 1 2)", // mistral
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
