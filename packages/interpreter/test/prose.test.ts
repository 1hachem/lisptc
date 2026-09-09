import { describe, expect, it } from "vitest";
import { MODEL } from "../src/channels.ts";
import {
	checkSyntax,
	Interp,
	prelude,
	runSync,
	str,
	stripProse,
} from "../src/lisp.ts";
import { isTruncated, proseExtension } from "../src/prose.ts";
import { ev, evWithOutput, freshInterp } from "./helpers.ts";

function collectSkips(interp: Interp): string[] {
	const skipped: string[] = [];
	interp.channels.on(MODEL, (d) => {
		if (d.severity === "warning") skipped.push(d.text);
	});
	return skipped;
}

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
		expect(evWithOutput('look: (echo "(not a form)") done').output).toBe(
			"(not a form)\n",
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

describe("tolerant prose (an LLM's parentheses)", () => {
	function tolerantly(text: string): { value: string; skipped: string[] } {
		const interp = new Interp({ extensions: [proseExtension()] });
		runSync(interp, prelude);
		const skipped = collectSkips(interp);
		const value = str(runSync(interp, text));
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

	it("reads a comma-separated aside as prose", () => {
		expect(tolerantly("Steps (one, two, three) then:\n(+ 1 2)").value).toBe(
			"3",
		);
	});

	it("recovers the forms after an unclosed parenthesis", () => {
		const { value, skipped } = tolerantly(
			"The result (roughly is fine\n(+ 1 2)",
		);
		expect(value).toBe("3");
		expect(skipped).toEqual(['unclosed "(" on line 1']);
	});

	it("reads a form it cannot parse as prose", () => {
		const { value, skipped } = tolerantly(
			"And others (including a deprecated `read_file`).\n(+ 1 2)",
		);
		expect(value).toBe("3");
		expect(skipped).toEqual([
			'(including a deprecated `read_file`) — unexpected ")" on line 1, so this was read as prose',
		]);
	});

	it("reports the line an unparseable form was on", () => {
		expect(
			tolerantly("(+ 1 2)\nsome prose\nand more (an aside `x`) here").skipped,
		).toEqual([
			'(an aside `x`) — unexpected ")" on line 3, so this was read as prose',
		]);
	});

	it("abbreviates a long unparseable form in its note", () => {
		const [note] = tolerantly(`(${"word ".repeat(30)}\`x\`)`).skipped;
		expect(note).toContain("...");
		expect(note.length).toBeLessThan(120);
	});

	it("reports the line an unclosed parenthesis was on", () => {
		expect(tolerantly("(+ 1 2)\none\ntwo (nearly\n").skipped).toEqual([
			'unclosed "(" on line 3',
		]);
	});

	it("evaluates a form whose head an earlier form defined", () => {
		expect(tolerantly("(defun see (x) 42)\n(see 1)").value).toBe("42");
	});

	it("leaves special forms and computed heads alone", () => {
		expect(tolerantly("(setq x 7) (progn x)").value).toBe("7");
		expect(tolerantly("((lambda (x) (* x 2)) 21)").value).toBe("42");
	});

	it("reads commas inside a string as part of the string", () => {
		expect(tolerantly('(string-split "a,b,c" ",")').value).toBe(
			'("a" "b" "c")',
		);
		expect(tolerantly('(list "a, b, c")').value).toBe('("a, b, c")');
	});

	it("still reports an undefined name inside a form", () => {
		expect(() => tolerantly("(+ 1 (nope 2))")).toThrow(/undefined: nope/);
	});

	describe("telling an aside from a call", () => {
		const asides = [
			"(see below)",
			"(one, two, three)",
			"(step 2)",
			"(e.g. see below)",
			"(i.e. the sum)",
			"(cf. above)",
			"(1, 2, 3)",
			"(2 agents, 10 MB storage, 100 credits)",
			"(50% done)",
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

		const calls: [string, string][] = [
			['(server/tool :key "value")', "server/tool"],
			["(server/tool)", "server/tool"],
			['(navigate :key "value")', "navigate"],
			["(step_two)", "step_two"],
			["(status :ok)", "status"],
			['(prin "hi")', "prin"],
			['(string-splt "a,b" ",")', "string-splt"],
			['(steps "one, two, three")', "steps"],
			['(join "a" "," "b")', "join"],
			["(fetch (car urls))", "fetch"],
		];
		it.each(calls)("errors on %s, naming %s", (text, name) => {
			expect(() => tolerantly(text)).toThrow(`undefined: ${name}`);
		});

		it("reads a phrase by its own shape, whatever heads it", () => {
			const { value, skipped } = tolerantly(
				"Free: €0 (2 agents, 10 MB storage, 100 credits)\n" +
					"DIY: €49.99/month (5 agents, 5 GB storage, 1,000 credits)\n" +
					"PRO: €199.99/month (Unlimited agents, 15 GB storage, 5,000 credits)",
			);
			expect(value).toBe("#<unspecified>");
			expect(skipped).toEqual([
				"(2 agents, 10 MB storage, 100 credits) — a comma-separated phrase, so this was read as prose",
				"(5 agents, 5 GB storage, 1,000 credits) — a comma-separated phrase, so this was read as prose",
				"(Unlimited agents, 15 GB storage, 5,000 credits) — a comma-separated phrase, so this was read as prose",
			]);
		});

		it.each([
			"(2 agents, 10 MB storage)",
			"(car, cdr and cons return values)",
			"(50 GB, 12 seats, no support)",
		])("reads %s as a phrase, though no head could say so", (text) => {
			expect(tolerantly(text).skipped[0]).toContain("a comma-separated phrase");
		});

		it("does not read a call with a comma in a string as a phrase", () => {
			expect(() => tolerantly('(report "a, b, c" x y z)')).toThrow(
				/undefined: report/,
			);
		});

		it("leaves a phrase headed by something bound as code", () => {
			expect(() => tolerantly("(list one, two, three, four)")).toThrow(
				/void variable/,
			);
		});

		it.each([
			"(lenght lst)",
			"(sq 5)",
			"(++ 1 2)",
		])("cannot tell %s from a turn of phrase, and says so", (text) => {
			expect(tolerantly(text).skipped[0]).toMatch(/is not defined/);
		});
	});

	it("tolerates nothing without the prose extension", () => {
		const bare = freshInterp();
		const skipped = collectSkips(bare);
		expect(() => runSync(bare, "(see below)")).toThrow(/undefined: see/);
		expect(() => runSync(bare, "a stray (paren\n(+ 1 2)")).toThrow();
		expect(() => runSync(bare, "an aside (see `x`)")).toThrow(/syntax error/);
		expect(skipped).toEqual([]);
	});

	it("takes a host's own classifier in place of the bundled one", () => {
		const interp = new Interp({
			extensions: [proseExtension(() => "everything is prose here")],
		});
		const skipped = collectSkips(interp);
		expect(str(runSync(interp, "(+ 1 2)"))).toBe("#<unspecified>");
		expect(skipped).toEqual(["everything is prose here"]);
	});

	it("changes nothing on an interp without the extension", () => {
		expect(() => ev("Here is the plan (see below)")).toThrow(/undefined: see/);
		expect(() => ev("here it comes (+ 1 2")).toThrow();
		expect(() => ev("an aside (see `x`)")).toThrow(/syntax error/);
		expect(checkSyntax("an aside (see `x`)")).toEqual([
			{ message: 'syntax error: unexpected ")" at 1', line: 1 },
		]);
		expect(stripProse("a (b")).toBe("  (b");
		const { hooks } = new Interp({ extensions: [proseExtension()] });
		expect(stripProse("a (b", hooks)).toBe("    ");
		expect(stripProse("a (see `x`)", hooks)).toBe("           ");
	});
});

describe("truncation", () => {
	it.each([
		"(+ 1",
		'(echo "hello',
		"(defun sq (x)",
		"prose first, then (+ 1",
	])("sees %s as cut off mid-form", (text) => {
		expect(isTruncated(text)).toBe(true);
	});

	it.each([
		"",
		"the sum is 3",
		"(+ 1 2)",
		"all done (see above)",
		"And others (including a deprecated `read_file`).",
		"a stray ) close paren is just text",
		'(echo "a (b")',
	])("sees %s as finished", (text) => {
		expect(isTruncated(text)).toBe(false);
	});
});
