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

	// A status is a keyword, so printing one must not need `(list …)` around
	// it: a keyword with no value after it cannot be an option.
	it("prints a trailing keyword as a value", () => {
		expect(evWithOutput("(echo :pending)").output).toBe(":pending\n");
		expect(evWithOutput('(echo "status:" :pending)').output).toBe(
			"status: :pending\n",
		);
		expect(evWithOutput("(echo (list :pending))").output).toBe("(:pending)\n");
	});

	it("rejects an unknown option", () => {
		expect(() => evWithOutput('(echo "x" :ofset 2)')).toThrow(/unknown option/);
	});

	// The other half of that trade: a keyword carrying a value IS an option,
	// misspelled or not, which is what keeps `:ofset 2` an error instead of
	// two words printed after the value. So a keyword mid-list still reads as
	// one — put it last, or wrap it.
	it("still reads a keyword with a value after it as an option", () => {
		expect(() => evWithOutput('(echo :pending "and counting")')).toThrow(
			/unknown option/,
		);
	});

	// A known option at the end is a forgotten value, not something to print.
	it("still reports a known option left without its value", () => {
		expect(() => evWithOutput("(echo :offset)")).toThrow(
			/odd-length keyword list/,
		);
	});
});

describe("echo: windowing", () => {
	it("shows :length words from :offset, with the offset to continue from", () => {
		const { output } = evWithOutput('(echo "a b c d e" :length 2)');
		expect(output).toContain("a b\n");
		expect(output).toContain("2 of 5 words shown, 3 below");
		expect(output).toContain(":offset 2");
	});

	it("pages from an offset", () => {
		expect(evWithOutput('(echo "a b c d e" :offset 3)').output).toContain(
			"d e",
		);
	});

	it("says so when there is nothing at the offset", () => {
		expect(evWithOutput('(echo "a b" :offset 9)').output).toContain(
			"nothing at :offset 9",
		);
	});

	it("names the global holding the value in the read-on hint", () => {
		const { output } = evWithOutput(
			'(setq doc "a b c d e") (echo doc :length 2)',
		);
		expect(output).toContain("(echo doc :offset 2)");
	});
});

describe("echo: :match", () => {
	it("prints each hit with its word offset and the match marked", () => {
		const { output } = evWithOutput(
			'(echo "the auth token expires" :match "auth" :context 1)',
		);
		expect(output).toContain("@1");
		expect(output).toContain("[[auth]]");
		expect(output).toContain('1 match for "auth"');
	});

	it("says so when nothing matches", () => {
		expect(evWithOutput('(echo "abc" :match "zzz")').output).toContain(
			'no match for "zzz"',
		);
	});

	it("matches case-insensitively unless told otherwise", () => {
		expect(evWithOutput('(echo "AUTH" :match "auth")').output).toContain(
			"[[AUTH]]",
		);
		expect(
			evWithOutput('(echo "AUTH" :match "auth" :ignore-case nil)').output,
		).toContain("no match");
	});

	it("rejects an unparseable pattern", () => {
		expect(() => evWithOutput('(echo "x" :match "(")')).toThrow(
			/invalid regular expression/,
		);
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
