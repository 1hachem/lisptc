import { describe, expect, it } from "vitest";
import {
	addArgument,
	closeParens,
	pushPositional,
	renameSymbol,
	replaceOnce,
} from "../src/edits.ts";

describe("replaceOnce", () => {
	it("replaces text found exactly once", () => {
		expect(replaceOnce("(car xs)", "car", "cdr")).toBe("(cdr xs)");
	});

	it("refuses text found nowhere or more than once", () => {
		expect(() => replaceOnce("(car xs)", "cdr", "x")).toThrow(/not found/);
		expect(() => replaceOnce("(f a) (f b)", "(f", "(g")).toThrow(
			/more than once/,
		);
	});
});

describe("renameSymbol", () => {
	it("renames every occurrence of the symbol and nothing that only contains it", () => {
		expect(renameSymbol("(totl (totl xs) totls)", "totl", "total")).toBe(
			"(total (total xs) totls)",
		);
	});

	it("leaves a string that spells the name alone", () => {
		expect(renameSymbol('(echo "totl" totl)', "totl", "total")).toBe(
			'(echo "totl" total)',
		);
	});

	it("refuses a symbol that is not there", () => {
		expect(() => renameSymbol("(a)", "b", "c")).toThrow(/not in rejected/);
	});
});

describe("closeParens", () => {
	it("closes what is left open, at the end", () => {
		expect(closeParens("(list 1 (car xs)\n")).toBe("(list 1 (car xs))");
		expect(closeParens("(a (b")).toBe("(a (b))");
	});

	it("ignores parentheses inside a string", () => {
		expect(closeParens('(echo "(("')).toBe('(echo "((")');
	});

	it("refuses balanced code", () => {
		expect(() => closeParens("(a)")).toThrow(/no parenthesis/);
	});
});

describe("addArgument", () => {
	it("adds the argument at the end of the one call", () => {
		expect(addArgument('(load-mcp :url "x")', "load-mcp", ':name "s"')).toBe(
			'(load-mcp :url "x" :name "s")',
		);
	});

	it("refuses a call that is missing or there twice", () => {
		expect(() => addArgument("(g 1)", "f", "2")).toThrow(/no closed call/);
		expect(() => addArgument("(f 1) (f 2)", "f", "3")).toThrow(/2 times/);
	});
});

describe("pushPositional", () => {
	it("puts the argument before the call's keywords", () => {
		expect(pushPositional("(f a :k (g 1))", "f", "b")).toBe("(f a b :k (g 1))");
	});

	it("appends when the call takes no keywords", () => {
		expect(pushPositional("(f (g :k 1))", "f", "b")).toBe("(f (g :k 1) b)");
	});
});
