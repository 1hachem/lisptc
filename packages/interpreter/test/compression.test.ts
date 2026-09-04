import { describe, expect, it } from "vitest";
import { Compressor, compressionExtension } from "../src/compression.ts";
import { Interp, prelude, run, setWriter, str } from "../src/lisp.ts";
import { secretsExtension } from "../src/secrets.ts";
import { ev, freshInterp } from "./helpers.ts";

// A small limit keeps the fixtures readable; the built-ins take theirs from the
// Compressor the extension was built with.
function interpWithLimit(limit: number): { interp: Interp; c: Compressor } {
	const c = new Compressor(limit);
	const interp = new Interp({
		extensions: [secretsExtension(), compressionExtension(c)],
	});
	run(interp, prelude);
	return { interp, c };
}

/*
 * Run one step and return both copies of what `echo` wrote: `user` off the
 * writer, `model` off the compressor. They differ by design — the human's is
 * uncapped, the model's is bounded by the step's word budget.
 */
function stepped(
	code: string,
	given?: { interp: Interp; c: Compressor },
): { user: string; model: string } {
	const { interp, c } = given ?? { interp: freshInterp(), c: undefined };
	const compressor = c;
	compressor?.beginStep();
	let user = "";
	const prev = setWriter((s) => {
		user += s;
	});
	try {
		run(interp, code);
	} finally {
		setWriter(prev);
	}
	return { user, model: compressor?.takeEcho() ?? user };
}

// What the human saw.
function echoed(
	code: string,
	given?: { interp: Interp; c: Compressor },
): string {
	return stepped(code, given).user;
}

const words = '(setq w "a b c d e f g h i j k l")';

describe("echo respects the compressor's limit", () => {
	// The limit bounds the MODEL's copy: `:length 99` is honoured for the human.
	it("caps the model's copy at the limit however much was asked for", () => {
		const given = interpWithLimit(4);
		run(given.interp, words);
		const { user, model } = stepped("(echo w :length 99)", given);
		expect(user).toBe("a b c d e f g h i j k l\n");
		expect(model).toContain("a b c d\n");
		expect(model).toContain("4 of 12 words shown");
	});

	it("reports the end of the value rather than a next offset", () => {
		const given = interpWithLimit(4);
		run(given.interp, words);
		expect(stepped("(echo w :offset 8)", given).model).toBe(
			"i j k l\n... 4 of 12 words shown, 8 above — back to the start with (echo w :offset 0)\n",
		);
	});

	it("names the value in the marker only when a global holds it", () => {
		const given = interpWithLimit(3);
		run(given.interp, words);
		expect(stepped("(echo w)", given).model).toContain("(echo w :offset 3)");
		// A literal is bound to nothing, so there is no name to suggest.
		expect(stepped('(echo "a b c d e")', given).model).toContain(
			"read on from :offset 3",
		);
	});

	it("preserves interior newlines rather than re-joining words", () => {
		// A window is sliced out of the original text by character offset, so
		// the whitespace between words survives; re-joining on " " would flatten
		// tool output into one line.
		expect(echoed('(echo "one\\ntwo\\nthree")')).toBe("one\ntwo\nthree\n");
	});

	it("rejects a negative offset", () => {
		expect(() => echoed('(echo "a b" :offset -1)')).toThrow(
			/non-negative integer expected for :offset/,
		);
		expect(() => echoed('(echo "a b" :offset)')).toThrow(
			/odd-length keyword list/,
		);
	});
});

describe("echo :match", () => {
	it("feeds its offset straight back into echo", () => {
		const given = interpWithLimit(20);
		run(given.interp, words);
		expect(echoed('(echo w :match "g" :context 0)', given)).toContain(
			"@6  [[g]]",
		);
		expect(echoed("(echo w :offset 6 :length 1)", given)).toContain("g");
	});

	it("collapses hits that fall inside a window already shown", () => {
		const given = interpWithLimit(20);
		run(given.interp, words);
		expect(echoed('(echo w :match "[a-l]" :context 3)', given)).toContain(
			"in a region already shown",
		);
	});

	it("honours :max", () => {
		const out = echoed('(echo "x y x y x y x y" :match "x" :context 0 :max 2)');
		expect(out.split("\n").filter((l) => l.startsWith("@"))).toHaveLength(2);
	});

	it("points at grep for keeping what matched", () => {
		expect(echoed('(echo "cat cot" :match "c[ao]t")')).toContain(
			'(grep <value> "c[ao]t")',
		);
	});

	it("terminates on a pattern that matches the empty string", () => {
		expect(echoed('(echo "a b c" :match "a*")')).toContain("matches");
	});
});

describe("head and tail", () => {
	it("take elements from a list, not words", () => {
		expect(ev("(head '(1 2 3 4) 2)")).toBe("(1 2)");
		expect(ev("(tail '(1 2 3 4) 2)")).toBe("(3 4)");
	});

	it("take words from text", () => {
		expect(ev('(head "a b c d" 2)')).toBe('"a b"');
		expect(ev('(tail "a b c d" 2)')).toBe('"c d"');
	});

	it("default to a handful of elements, or the word limit for text", () => {
		expect(ev("(length (head '(1 2 3 4 5 6 7 8 9 10 11 12)))")).toBe("10");
		expect(ev('(head "a b c d e")', interpWithLimit(3).interp)).toBe('"a b c"');
	});

	it("ask for more than there is without complaint", () => {
		expect(ev("(head '(1 2) 9)")).toBe("(1 2)");
		expect(ev("(tail '(1 2) 9)")).toBe("(1 2)");
		expect(ev("(head nil 3)")).toBe("nil");
	});

	it("reject a count that is not a non-negative integer", () => {
		expect(() => ev('(head "a b" -1)')).toThrow(
			/non-negative integer expected/,
		);
	});
});

describe("grep returns what matched", () => {
	it("returns the matching ELEMENTS of a list", () => {
		expect(ev(`(grep (list "auth token" "billing" "oauth flow") "auth")`)).toBe(
			'("auth token" "oauth flow")',
		);
	});

	it("returns the matched SUBSTRINGS of text", () => {
		expect(
			ev(`(grep "see https://x.dev/a and https://y.dev/b" "https?://[^ ]+")`),
		).toBe('("https://x.dev/a" "https://y.dev/b")');
	});

	it("keeps one capture group with :group", () => {
		expect(ev(`(grep "a=1 b=2" "(\\\\w)=(\\\\d)" :group 2)`)).toBe('("1" "2")');
	});

	it("returns nil when nothing matched", () => {
		expect(ev('(grep "a b c" "zzz")')).toBe("nil");
		expect(ev('(grep (list "a") "zzz")')).toBe("nil");
	});

	it("honours :max on both shapes", () => {
		expect(ev('(grep "x x x" "x" :max 2)')).toBe('("x" "x")');
		expect(ev('(grep (list "x" "x" "x") "x" :max 1)')).toBe('("x")');
	});

	it("is case-insensitive unless told otherwise", () => {
		expect(ev('(grep "Alpha" "alpha")')).toBe('("Alpha")');
		expect(ev('(grep "Alpha" "alpha" :ignore-case nil)')).toBe("nil");
	});

	it("rejects an invalid regular expression", () => {
		expect(() => ev('(grep "a b c" "[")')).toThrow(
			/invalid regular expression/,
		);
	});

	it("terminates on a pattern that matches the empty string", () => {
		expect(ev('(grep "ab" "a*")')).toContain('"a"');
	});

	// The point of returning rather than printing: the result is an ordinary
	// value, so the next step computes over it instead of retyping a printout.
	it("hands its result to the next form", () => {
		expect(ev(`(car (grep "see https://x.dev/a now" "https?://[^ ]+"))`)).toBe(
			'"https://x.dev/a"',
		);
	});
});

describe("the character backstop", () => {
	// A word cap alone bounds nothing: minified JSON is one enormous word.
	it("hard-cuts a single word past the character budget", () => {
		const given = interpWithLimit(2); // 2 * 12 = 24 characters
		run(given.interp, '(setq blob "0123456789012345678901234567890123456789")');
		const { user, model } = stepped("(echo blob)", given);
		// The human's copy is the whole blob; only the model's is cut.
		expect(user).toContain("0123456789012345678901234567890123456789");
		expect(model).toContain("012345678901234567890123");
		expect(model).toContain("24 of 40 characters shown (one unbroken word)");
		// Word offsets cannot step inside a word, so substring is the way on.
		expect(model).toContain("(echo (substring blob 24 40))");
	});
});

describe("secret taint", () => {
	function withSecret(value: string): { interp: Interp; c: Compressor } {
		const c = new Compressor();
		const interp = new Interp({
			extensions: [
				secretsExtension({
					store: {
						get: () => ({ value, description: "" }),
						list: () => [["REPL_K", ""]],
						set: () => {},
					},
				}),
				compressionExtension(c),
			],
		});
		run(interp, prelude);
		return { interp, c };
	}

	// These commands slice and filter text, so they are exactly where an
	// untainted fragment of a secret would escape. They cannot leak one: they
	// measure a value through its PRINTED form, and a secret prints redacted.
	it("cannot be read around by echo, head or grep", () => {
		const given = withSecret("open-sesame");
		expect(echoed('(echo (secret "REPL_K"))', given)).toBe(
			"#<secret:REPL_K>\n",
		);
		expect(ev('(head (secret "REPL_K") 5)', given.interp)).toBe(
			'"#<secret:REPL_K>"',
		);
		expect(ev('(grep (secret "REPL_K") "sesame")', given.interp)).toBe("nil");
		expect(ev('(grep (list (secret "REPL_K")) "sesame")', given.interp)).toBe(
			"nil",
		);
	});
});

describe("reporting a result", () => {
	function reportOf(interp: Interp, c: Compressor, code: string): string {
		let form: unknown;
		const value = run(interp, code, (f) => {
			form = f;
		});
		return c.result(interp, form, value);
	}

	function fresh(limit = 400): { interp: Interp; c: Compressor } {
		const c = new Compressor(limit);
		const interp = new Interp({ extensions: [compressionExtension(c)] });
		run(interp, prelude);
		return { interp, c };
	}

	it("reports a small value as itself", () => {
		const { interp, c } = fresh();
		expect(reportOf(interp, c, "(+ 1 2)")).toBe("+-1: 3\n");
		expect(reportOf(interp, c, '(progn "hi")')).toBe('progn-1: "hi"\n');
	});

	it("describes a long list by its size, never its contents", () => {
		const { interp, c } = fresh();
		const line = reportOf(interp, c, "(list 1 2 3 4 5 6 7 8 9 10 11 12)");
		expect(line).toBe("list-1: list of 12 items, 12 words\n");
		// The binding is the complete value, not something summarised away.
		expect(ev("(length list-1)", interp)).toBe("12");
	});

	it("describes a list of alists by its keys", () => {
		const { interp, c } = fresh();
		const line = reportOf(
			interp,
			c,
			`(list (list (cons "id" "a1f") (cons "title" "Auth token refresh fails"))
			       (list (cons "id" "b2e") (cons "title" "OAuth callback drops state")))`,
		);
		expect(line).toBe('list-1: list of 2 alists, keys "id" "title"\n');
	});

	it("flags a list whose alists disagree on their keys", () => {
		const { interp, c } = fresh();
		const line = reportOf(
			interp,
			c,
			`(list (list (cons "id" "a1f") (cons "title" "Auth token refresh fails"))
			       (list (cons "id" "b2e") (cons "state" "OAuth callback drops state")))`,
		);
		expect(line).toContain("(keys vary)");
	});

	it("describes a single alist by its keys", () => {
		const { interp, c } = fresh();
		const line = reportOf(
			interp,
			c,
			`(list (cons "id" "a1f") (cons "title" "Auth token refresh fails") (cons "state" "open"))`,
		);
		expect(line).toBe('list-1: alist, keys "id" "title" "state"\n');
	});

	it("describes long text by its word count, and a blob by its characters", () => {
		const { interp, c } = fresh();
		expect(reportOf(interp, c, '(concat "a b c d e f g h i j k" " l")')).toBe(
			"concat-1: 12 words\n",
		);
		// A blob is only described once showing it would cost more than saying
		// how big it is.
		expect(
			reportOf(interp, c, `(concat "${"0123456789".repeat(20)}" "")`),
		).toBe("concat-2: 200 characters\n");
	});

	it("reports a definition as what it defined, not as interpreter internals", () => {
		const { interp, c } = fresh();
		expect(reportOf(interp, c, "(defun f (x) x)")).toBe("f: function\n");
		expect(reportOf(interp, c, "(defmacro m (x) x)")).toBe("m: macro\n");
	});

	it("reports nil and t without minting a name", () => {
		const { interp, c } = fresh();
		expect(reportOf(interp, c, "(progn nil)")).toBe("nil\n");
		expect(reportOf(interp, c, "(progn t)")).toBe("t\n");
		expect(interp.globalNames().filter((n) => /-\d+$/.test(n))).toEqual([]);
	});

	it("says nothing at all for a step that ended in an echo", () => {
		const { interp, c } = fresh();
		expect(reportOf(interp, c, '(echo "hi")')).toBe("");
	});

	it("numbers per function name and never clobbers an existing global", () => {
		const { interp, c } = fresh();
		run(interp, "(setq list-1 999)");
		expect(reportOf(interp, c, "(list 1 2 3 4)")).toContain("list-2:");
		expect(reportOf(interp, c, "(list 1 2 3 4)")).toContain("list-3:");
		expect(ev("(progn list-1)", interp)).toBe("999");
	});

	it("reuses the name a value is already bound under", () => {
		const { interp, c } = fresh();
		// setq bound the value before it came back, so there is nothing to mint.
		expect(reportOf(interp, c, "(setq mine (list 1 2 3 4))")).toContain(
			"mine:",
		);
		expect(interp.globalNames().filter((n) => /^setq-/.test(n))).toEqual([]);
	});

	it("falls back to result-N for a form with no symbol at its head", () => {
		const { interp, c } = fresh();
		expect(reportOf(interp, c, "((lambda (x) (list x x x x)) 1)")).toContain(
			"result-1:",
		);
	});

	it("documents every global it binds", () => {
		const { interp, c } = fresh();
		reportOf(interp, c, "(list 1 2 3 4)");
		const docs = interp.docs();
		const undocumented = interp
			.globalNames()
			.filter((name) => !name.startsWith("_") && !docs.has(name));
		expect(undocumented).toEqual([]);
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

describe("the step's echo budget", () => {
	function stepping(limit: number): { interp: Interp; c: Compressor } {
		const c = new Compressor(limit);
		const interp = new Interp({ extensions: [compressionExtension(c)] });
		run(interp, prelude);
		c.beginStep();
		return { interp, c };
	}

	it("caps the model's copy and leaves the human's whole", () => {
		const { interp, c } = stepping(3);
		run(interp, '(setq doc "a b c d e f") (echo doc)');
		expect(c.takeEcho()).toBe(
			"a b c\n... 3 of 6 words shown, 3 below — read on with (echo doc :offset 3)\n",
		);
	});

	// The budget is per step, not per call: a loop of small echoes spends it
	// just as surely as one large one.
	it("is shared across the echoes of one step", () => {
		const { interp, c } = stepping(4);
		run(interp, '(progn (echo "a b c") (echo "d e f") (echo "g h i"))');
		const echoed = c.takeEcho();
		expect(echoed).toContain("a b c\n");
		expect(echoed).toContain("not shown to you");
		expect(echoed).not.toContain("g h i");
	});

	it("starts over on the next step", () => {
		const { interp, c } = stepping(4);
		run(interp, '(progn (echo "a b c d") (echo "e f"))');
		expect(c.takeEcho()).toContain("not shown");
		c.beginStep();
		run(interp, '(echo "x y")');
		expect(c.takeEcho()).toBe("x y\n");
	});

	it("passes short output through untouched", () => {
		const { interp, c } = stepping(400);
		run(interp, '(echo "a b")');
		expect(c.takeEcho()).toBe("a b\n");
	});
});

describe("the compression built-ins are documented", () => {
	it("carries a signature and doc for each", () => {
		const docs = freshInterp().docs();
		for (const name of ["echo", "head", "tail", "grep"]) {
			expect(docs.get(name)?.signature).toContain(name);
			expect(docs.get(name)?.doc.length ?? 0).toBeGreaterThan(20);
		}
	});
});
