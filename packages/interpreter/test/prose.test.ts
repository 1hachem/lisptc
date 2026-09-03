import { describe, expect, it } from "vitest";
import { checkSyntax, run, str, stripProse } from "../src/lisp.ts";
import { ev, evWithOutput, freshInterp } from "./helpers.ts";

describe("prose around forms", () => {
	it("evaluates the forms and ignores the text between them", () => {
		expect(ev("Here we go: (+ 1 2) and that is the answer.")).toBe("3");
		expect(
			ev("First define it.\n(defun sq (x) (* x x))\nThen use it: (sq 5)"),
		).toBe("25");
	});

	it("ignores punctuation that would otherwise be read as code", () => {
		expect(ev("(+ 1 2) happy to help :)")).toBe("3");
		expect(ev("a stray ) close paren is just text (+ 1 2)")).toBe("3");
		expect(ev("don't worry about apostrophes (+ 1 2)")).toBe("3");
	});

	it("evaluates a program with no form at all to nothing", () => {
		expect(ev("just thinking out loud, no code here")).toBe("#<unspecified>");
		expect(ev("")).toBe("#<unspecified>");
	});

	it("treats a bare top-level atom as prose", () => {
		expect(ev("16")).toBe("#<unspecified>");
		expect(ev("no-such-var")).toBe("#<unspecified>");
	});

	it("keeps reader sugar written against a top-level form", () => {
		expect(ev("the list is '(1 2 3)")).toBe("(1 2 3)");
		expect(ev("(setq x 2) quasiquoted: `(1 ,x)")).toBe("(1 2)");
	});

	it("does not read prose punctuation touching a form as sugar", () => {
		expect(stripProse("and then,(+ 1 2)")).toBe("         (+ 1 2)");
	});

	it("does not end a form at a paren inside a string", () => {
		expect(evWithOutput('look: (princ "(not a form)") done').output).toBe(
			"(not a form)",
		);
	});

	it("still reports an unclosed form rather than swallowing it", () => {
		expect(() => ev("here it comes (+ 1 2")).toThrow();
	});

	it("reports syntax errors at their line in the original text", () => {
		expect(checkSyntax("some prose\nmore prose\n(a . )")).toEqual([
			{ message: 'syntax error: unexpected ")" at 3', line: 3 },
		]);
		expect(checkSyntax("prose only, and a smiley :)")).toEqual([]);
	});

	it("blanks prose in place so offsets are preserved", () => {
		expect(stripProse("hi (+ 1 2) bye")).toBe("   (+ 1 2)    ");
		expect(stripProse("one\n(+ 1 2)\ntwo")).toBe("   \n(+ 1 2)\n   ");
	});
});

describe("no comment syntax", () => {
	it("reads `;` as an ordinary symbol character inside a form", () => {
		expect(ev("(progn ';)")).toBe(";");
		expect(() => ev("(list 1 ; 2)")).toThrow(/void variable/);
	});

	it("ignores a `;` line outside a form, like any other prose", () => {
		expect(ev(";; a section header\n(+ 1 2)")).toBe("3");
	});
});

/*
 * A model writes prose with parentheses in it. The grammar that forbids that
 * (`lisptc.gbnf`) only binds providers that support grammars, so the reader
 * has to cope: under `tolerant`, text that cannot be a program is prose, and
 * every skip is reported rather than silently dropped.
 */
describe("tolerant prose (an LLM's parentheses)", () => {
	// What the model wrote, and what it should be read as.
	function tolerantly(text: string): { value: string; skipped: string[] } {
		const skipped: string[] = [];
		const value = str(
			run(freshInterp(), text, {
				prose: "tolerant",
				onProse: (what) => skipped.push(what),
			}),
		);
		return { value, skipped };
	}

	it("reads a form whose head names nothing as prose", () => {
		const { value, skipped } = tolerantly(
			"Here is the plan (see below):\n(+ 1 2)",
		);
		expect(value).toBe("3");
		expect(skipped).toEqual([
			'(see below) — "see" is not defined, so this was read as prose',
		]);
	});

	// Commas are unquote sugar, so a list written in prose is not even readable
	// as a call — but it is still just a sentence.
	it("reads a comma-separated aside as prose", () => {
		expect(tolerantly("Steps (one, two, three) then:\n(+ 1 2)").value).toBe(
			"3",
		);
	});

	// The destructive case: `endOfForm` runs to the end of the text, so a stray
	// "(" used to swallow every real form after it and lose the whole step.
	it("recovers the forms after an unclosed parenthesis", () => {
		const { value, skipped } = tolerantly(
			"The result (roughly is fine\n(+ 1 2)",
		);
		expect(value).toBe("3");
		expect(skipped).toEqual(['unclosed "(" on line 1']);
	});

	it("reports the line an unclosed parenthesis was on", () => {
		expect(tolerantly("(+ 1 2)\none\ntwo (nearly\n").skipped).toEqual([
			'unclosed "(" on line 3',
		]);
	});

	// Boundness is decided per form as the program runs, so a definition
	// earlier in the same program counts.
	it("evaluates a form whose head an earlier form defined", () => {
		expect(tolerantly("(defun see (x) 42)\n(see 1)").value).toBe("42");
	});

	it("leaves special forms and computed heads alone", () => {
		expect(tolerantly("(setq x 7) (progn x)").value).toBe("7");
		expect(tolerantly("((lambda (x) (* x 2)) 21)").value).toBe("42");
	});

	// Only the head of a TOP-LEVEL form is a prose candidate: a typo deeper in
	// an expression is a real mistake and has to stay an error.
	it("still reports an undefined name inside a form", () => {
		expect(() => tolerantly("(+ 1 (nope 2))")).toThrow(/undefined: nope/);
	});

	/*
	 * Where tolerance stops, case by case. Both halves of the line cost
	 * something to get wrong: an aside read as code spends the step on an error
	 * the agent cannot act on, and a call read as prose vanishes into a skip
	 * note — a tool whose server was never loaded has to say so, since silence
	 * is the one failure the agent cannot debug.
	 */
	describe("telling an aside from a call", () => {
		// Sentences contain punctuation, digits, emoji, URLs and parentheses of
		// their own; none of that makes a form code.
		const asides = [
			"(see below)",
			"(one, two, three)",
			"(step 2)",
			"(e.g. see below)",
			"(i.e. the sum)",
			"(cf. above)",
			"(1, 2, 3)",
			"(50% done)",
			// A slash the sentence wrote, not a namespace: it is followed by a
			// word, which no bare tool call is.
			"(A/B test)",
			"(TODO: fix this)",
			"(don't panic)",
			"(see https://example.com)",
			"(🙂)",
			"(note (details here))",
		];
		it.each(asides)("reads %s as prose", (text) => {
			const { value, skipped } = tolerantly(text);
			expect(value).toBe("#<unspecified>");
			expect(skipped).toHaveLength(1);
		});

		// Each of these carries something a sentence never does: keyword call
		// syntax, a literal being passed, a namespaced name with no words around
		// it, or a call nested inside the call.
		const calls: [string, string][] = [
			['(server/tool :key "value")', "server/tool"],
			["(server/tool)", "server/tool"],
			['(navigate :key "value")', "navigate"],
			["(step_two)", "step_two"],
			["(status :ok)", "status"],
			['(prin "hi")', "prin"],
			['(string-splt "a,b" ",")', "string-splt"],
			["(fetch (car urls))", "fetch"],
		];
		it.each(calls)("errors on %s, naming %s", (text, name) => {
			expect(() => tolerantly(text)).toThrow(`undefined: ${name}`);
		});

		// The limit of the whole idea: a misspelled word and a written one are
		// the same shape. With no literal, no keyword and no namespace to go on,
		// a typo is read as prose — the skip note names it, and that is all the
		// reader can honestly offer.
		it.each([
			"(lenght lst)",
			"(sq 5)",
			"(++ 1 2)",
		])("cannot tell %s from a turn of phrase, and says so", (text) => {
			expect(tolerantly(text).skipped[0]).toMatch(/is not defined/);
		});
	});

	it("changes nothing under the default strict mode", () => {
		expect(() => ev("Here is the plan (see below)")).toThrow(/undefined: see/);
		expect(() => ev("here it comes (+ 1 2")).toThrow();
		expect(stripProse("a (b")).toBe("  (b");
		expect(stripProse("a (b", "tolerant")).toBe("    ");
	});
});
