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
		'"a string with \\" an escaped quote"',
		"(setq x 1)\n(print x)",
		"'(1 . 2)",
		"nil",
		"t",
		"-3.5e10",
	];
	it.each(valid)("accepts %j", (src) => {
		expect(accepts(g, src)).toBe(true);
	});

	const invalid = [
		"", // programs need at least one form
		"(", // unbalanced
		")", // stray close
		"(+ 1 2", // unterminated list
		"foo)", // trailing close
		'"unterminated', // open string
		"'", // quote with nothing to quote
		"(a . )", // dotted pair with no tail
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
