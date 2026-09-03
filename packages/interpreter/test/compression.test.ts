import { describe, expect, it } from "vitest";
import { Compressor, compressionExtension } from "../src/compression.ts";
import { Interp, prelude, run, str } from "../src/lisp.ts";
import { secretsExtension } from "../src/secrets.ts";
import { ev, freshInterp } from "./helpers.ts";

// A small limit keeps the fixtures readable; the built-ins take theirs from the
// Compressor the extension was built with.
function interpWithLimit(limit: number): Interp {
	const interp = new Interp({
		extensions: [
			secretsExtension(),
			compressionExtension(new Compressor(limit)),
		],
	});
	run(interp, prelude);
	return interp;
}

// `view` and friends return RawText, whose printed form is the window itself.
const words = '(setq w "a b c d e f g h i j k l")';

describe("view", () => {
	it("prints a short value whole, with no marker", () => {
		expect(ev('(view "a b c")')).toBe("a b c");
	});

	it("windows by word offset and length", () => {
		const interp = interpWithLimit(20);
		run(interp, words);
		expect(ev("(view w :offset 2 :length 3)", interp)).toBe(
			"c d e\n... 3 of 12 words shown, 2 above, 7 below — next (view w :offset 5)",
		);
	});

	it("caps :length at the output limit", () => {
		const interp = interpWithLimit(4);
		run(interp, words);
		expect(ev("(view w :length 99)", interp)).toContain("a b c d\n");
		expect(ev("(view w :length 99)", interp)).toContain("4 of 12 words shown");
	});

	it("reports the end of the value rather than a next offset", () => {
		const interp = interpWithLimit(4);
		run(interp, words);
		expect(ev("(view w :offset 8)", interp)).toBe(
			"i j k l\n... 4 of 12 words shown, 8 above — back to the start with (view w :offset 0)",
		);
	});

	it("says so when the offset is past the end", () => {
		const interp = interpWithLimit(4);
		run(interp, words);
		expect(ev("(view w :offset 99)", interp)).toBe(
			"(nothing at :offset 99; 12 words in total)",
		);
	});

	it("preserves interior newlines rather than re-joining words", () => {
		// A window is sliced out of the original text by character offset, so
		// the whitespace between words survives; re-joining on " " would flatten
		// tool output into one line.
		expect(ev('(view "one\\ntwo\\nthree")')).toBe("one\ntwo\nthree");
	});

	it("rejects a negative offset and an unknown option", () => {
		expect(() => ev('(view "a b" :offset -1)')).toThrow(
			/non-negative integer expected for :offset/,
		);
		// A silently-ignored typo is worse than an error: an agent that writes
		// :ofset must be told, not handed the default window as if it asked.
		expect(() => ev('(view "a b" :ofset 1)')).toThrow(/unknown option/);
		expect(() => ev('(view "a b" :offset)')).toThrow(/odd-length keyword list/);
	});

	it("names the value in the marker only when a global holds it", () => {
		const interp = interpWithLimit(3);
		run(interp, words);
		expect(ev("(view w)", interp)).toContain("(view w :offset 3)");
		// A literal is bound to nothing, so there is no name to suggest.
		expect(ev('(view "a b c d e")', interp)).toContain(
			"read on from :offset 3",
		);
	});
});

describe("head and tail", () => {
	it("agree with the equivalent view calls", () => {
		const interp = interpWithLimit(20);
		run(interp, words);
		expect(ev("(head w :length 3)", interp)).toBe(
			ev("(view w :offset 0 :length 3)", interp),
		);
		expect(ev("(tail w :length 3)", interp)).toBe(
			ev("(view w :offset 9 :length 3)", interp),
		);
	});

	it("windows text rather than acting like car/cdr", () => {
		expect(ev("(head '(1 2 3))")).toBe("(1 2 3)");
	});
});

describe("grep", () => {
	it("reports a hit as a word offset with the match marked", () => {
		const interp = interpWithLimit(20);
		run(interp, words);
		const out = ev('(grep w "c" :context 1)', interp);
		expect(out).toContain("@2  b [[c]] d");
		expect(out).toContain('1 match for "c" in 12 words');
	});

	it("feeds its offset straight into view", () => {
		const interp = interpWithLimit(20);
		run(interp, words);
		expect(ev('(grep w "g" :context 0)', interp)).toContain("@6  [[g]]");
		expect(ev("(view w :offset 6 :length 1)", interp)).toContain("g");
	});

	it("matches a regular expression, not just a literal", () => {
		expect(ev('(grep "cat cot cut" "c[ao]t" :context 0)')).toContain("@0");
	});

	it("is case-insensitive unless told otherwise", () => {
		expect(ev('(grep "Alpha" "alpha" :context 0)')).toContain("[[Alpha]]");
		expect(ev('(grep "Alpha" "alpha" :ignore-case nil)')).toContain("no match");
	});

	it("collapses hits that fall inside a window already shown", () => {
		const interp = interpWithLimit(20);
		run(interp, words);
		const out = ev('(grep w "[a-l]" :context 3)', interp);
		expect(out).toContain("in a region already shown");
	});

	it("honours :max", () => {
		const out = ev('(grep "x y x y x y x y" "x" :context 0 :max 2)');
		expect(out.split("\n").filter((l) => l.startsWith("@"))).toHaveLength(2);
	});

	it("reports no match", () => {
		expect(ev('(grep "a b c" "zzz")')).toBe(
			'... no match for "zzz" in 3 words',
		);
	});

	it("rejects an invalid regular expression", () => {
		expect(() => ev('(grep "a b c" "[")')).toThrow(
			/invalid regular expression/,
		);
	});

	it("terminates on a pattern that matches the empty string", () => {
		expect(ev('(grep "a b c" "a*")')).toContain("matches");
	});
});

describe("the character backstop", () => {
	// A word cap alone bounds nothing: minified JSON is one enormous word.
	it("hard-cuts a single word past the character budget", () => {
		const interp = interpWithLimit(2); // 2 * 12 = 24 characters
		run(interp, '(setq blob "0123456789012345678901234567890123456789")');
		const out = ev("(view blob)", interp);
		expect(out).toContain("012345678901234567890123");
		expect(out).toContain("24 of 40 characters shown (one unbroken word)");
		// Word offsets cannot step inside a word, so substring is the way on.
		expect(out).toContain("(substring blob 24 40)");
	});
});

describe("secret taint", () => {
	it("cannot be read around by view or grep", () => {
		const interp = new Interp({
			extensions: [
				secretsExtension({
					store: {
						get: () => ({ value: "open-sesame", description: "" }),
						list: () => [["REPL_K", ""]],
						set: () => {},
					},
				}),
				compressionExtension(),
			],
		});
		run(interp, prelude);
		expect(ev('(view (secret "REPL_K"))', interp)).toBe("#<secret:REPL_K>");
		expect(ev('(grep (list (secret "REPL_K")) "sesame")', interp)).toContain(
			"no match",
		);
	});
});

describe("naming a result", () => {
	function nameOf(interp: Interp, c: Compressor, code: string): string {
		let form: unknown;
		const value = run(interp, code, (f) => {
			form = f;
		});
		return c.value(interp, form, value).text;
	}

	it("binds a truncated result to a fresh global holding the whole value", () => {
		const c = new Compressor(3);
		const interp = new Interp({ extensions: [compressionExtension(c)] });
		run(interp, prelude);
		expect(nameOf(interp, c, "(list 1 2 3 4 5 6)")).toContain(
			"list-1 = (1 2 3",
		);
		// The binding is the complete value, not the fragment that was printed.
		expect(ev("(length list-1)", interp)).toBe("6");
	});

	it("numbers per function name and never clobbers an existing global", () => {
		const c = new Compressor(3);
		const interp = new Interp({ extensions: [compressionExtension(c)] });
		run(interp, prelude);
		run(interp, "(setq list-1 999)");
		expect(nameOf(interp, c, "(list 1 2 3 4)")).toContain("list-2 =");
		expect(nameOf(interp, c, "(list 1 2 3 4)")).toContain("list-3 =");
		expect(ev("(progn list-1)", interp)).toBe("999");
	});

	it("reuses the name a value is already bound under", () => {
		const c = new Compressor(3);
		const interp = new Interp({ extensions: [compressionExtension(c)] });
		run(interp, prelude);
		// setq bound the value before it came back, so there is nothing to mint.
		expect(nameOf(interp, c, "(setq mine (list 1 2 3 4))")).toContain("mine =");
		expect(interp.globalNames().filter((n) => /^setq-/.test(n))).toEqual([]);
	});

	it("echoes a definition, nil and t without minting a name", () => {
		const c = new Compressor(3);
		const interp = new Interp({ extensions: [compressionExtension(c)] });
		run(interp, prelude);
		expect(nameOf(interp, c, "(defun f (x) x)")).toBe("f\n");
		expect(nameOf(interp, c, "(progn nil)")).toBe("nil\n");
		expect(nameOf(interp, c, "(progn t)")).toBe("t\n");
		expect(interp.globalNames().filter((n) => /-\d+$/.test(n))).toEqual([]);
	});

	it("falls back to result-N for a form with no symbol at its head", () => {
		const c = new Compressor(3);
		const interp = new Interp({ extensions: [compressionExtension(c)] });
		run(interp, prelude);
		expect(nameOf(interp, c, "((lambda (x) (list x x x x)) 1)")).toContain(
			"result-1 =",
		);
	});

	it("documents every global it binds", () => {
		const c = new Compressor(3);
		const interp = new Interp({ extensions: [compressionExtension(c)] });
		run(interp, prelude);
		nameOf(interp, c, "(list 1 2 3 4)");
		const docs = interp.docs();
		const undocumented = interp
			.globalNames()
			.filter((name) => !name.startsWith("_") && !docs.has(name));
		expect(undocumented).toEqual([]);
	});

	it("prints an untruncated value exactly as str would", () => {
		const c = new Compressor(400);
		const interp = new Interp({ extensions: [compressionExtension(c)] });
		run(interp, prelude);
		expect(nameOf(interp, c, '(progn "hi")')).toBe('progn-1 = "hi"\n');
		expect(str("hi")).toBe('"hi"');
	});

	it("leaves a Secret's printed form alone", () => {
		// `Secret` is unexported by design — no Secret value can exist without
		// the extension — so mint one through the built-in and check `str` on it.
		const interp = new Interp({
			extensions: [
				secretsExtension({
					store: {
						get: () => ({ value: "shh", description: "" }),
						list: () => [["REPL_K", ""]],
						set: () => {},
					},
				}),
			],
		});
		run(interp, prelude);
		expect(str(run(interp, '(secret "REPL_K")'))).toBe("#<secret:REPL_K>");
	});
});

describe("the read-more built-ins are documented", () => {
	it("carries a signature and doc for each", () => {
		const docs = freshInterp().docs();
		for (const name of ["view", "head", "tail", "grep"]) {
			expect(docs.get(name)?.signature).toContain(name);
			expect(docs.get(name)?.doc.length ?? 0).toBeGreaterThan(20);
		}
	});
});
