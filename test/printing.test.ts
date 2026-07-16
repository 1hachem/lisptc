import { describe, expect, it } from "vitest";
import { ev, evWithOutput } from "./helpers.ts";

describe("output functions", () => {
	it("princ prints without quoting; returns its argument", () => {
		const { value, output } = evWithOutput('(princ "hello")');
		expect(output).toBe("hello");
		expect(value).toBe('"hello"');
	});

	it("prin1 prints the readable (quoted) form", () => {
		const { output } = evWithOutput('(prin1 "hi")');
		expect(output).toBe('"hi"');
	});

	it("print adds a trailing newline and returns its argument", () => {
		const { value, output } = evWithOutput("(print 42)");
		expect(output).toBe("42\n");
		expect(value).toBe("42");
	});

	it("terpri writes a newline and returns t", () => {
		const { value, output } = evWithOutput("(terpri)");
		expect(output).toBe("\n");
		expect(value).toBe("t");
	});

	it("princ prints floats with .0", () => {
		expect(evWithOutput("(princ 3.0)").output).toBe("3.0");
	});

	it("side effects run left-to-right within a progn", () => {
		expect(
			evWithOutput('(progn (princ "a") (princ "b") (princ "c"))').output,
		).toBe("abc");
	});
});

describe("printer: nested and shared structure", () => {
	it("prints deeply nested lists", () => {
		expect(ev("'(1 (2 (3 (4 (5)))))")).toBe("(1 (2 (3 (4 (5)))))");
	});

	// Building a cycle and printing it must terminate (ellipsis), not hang.
	it("prints circular lists with an ellipsis instead of looping forever", () => {
		const out = ev("(setq l (list 1 2 3)) (rplacd (cddr l) l) l");
		expect(out).toContain("...");
		expect(out.startsWith("(1 2 3")).toBe(true);
	});
});
