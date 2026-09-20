import { describe, expect, it } from "vitest";
import { ev, evWithOutput } from "./helpers.ts";

describe("echo", () => {
	it("prints a string as it is, with a trailing newline", () => {
		const { value, output } = evWithOutput('(echo "hello")');
		expect(output).toBe("hello\n");
		expect(value).toBe("#<unspecified>");
	});

	it("prints everything else in re-readable form", () => {
		expect(evWithOutput('(echo (list 1 "two"))').output).toBe('(1 "two")\n');
	});

	it("separates several arguments with spaces", () => {
		expect(evWithOutput('(echo "a" 1 (list 2))').output).toBe("a 1 (2)\n");
	});

	it("prints a bare newline with no arguments", () => {
		expect(evWithOutput("(echo)").output).toBe("\n");
	});

	it("prints floats with .0", () => {
		expect(evWithOutput("(echo 3.0)").output).toBe("3.0\n");
	});

	it("side effects run left-to-right within a progn", () => {
		expect(
			evWithOutput('(progn (echo "a") (echo "b") (echo "c"))').output,
		).toBe("a\nb\nc\n");
	});

	it("prints a trailing keyword as a value", () => {
		expect(evWithOutput("(echo :pending)").output).toBe(":pending\n");
		expect(evWithOutput('(echo "status:" :pending)').output).toBe(
			"status: :pending\n",
		);
		expect(evWithOutput("(echo (list :pending))").output).toBe("(:pending)\n");
	});
});

describe("printer: nested and shared structure", () => {
	it("prints deeply nested lists", () => {
		expect(ev("'(1 (2 (3 (4 (5)))))")).toBe("(1 (2 (3 (4 (5)))))");
	});

	it("prints circular lists with an ellipsis instead of looping forever", () => {
		const out = ev("(setq l (list 1 2 3)) (rplacd (cddr l) l) l");
		expect(out).toContain("...");
		expect(out.startsWith("(1 2 3")).toBe(true);
	});
});
