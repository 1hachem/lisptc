import { type Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { str } from "@repo/interpreter/print";
import { checkSyntax } from "@repo/language-service/syntax";
import { describe, expect, it } from "vitest";
import type { ProseClassifier } from "../src/ports.ts";
import { stripProse } from "../src/prose.ts";
import { proseHost } from "../src/prose-host.ts";
import {
	collectSkips,
	endsTurn,
	ev,
	evProse,
	evWithOutput,
	freshInterp,
	proseInterp,
	tolerantly,
} from "./helpers.ts";

describe("prose around forms", () => {
	it("evaluates the forms and ignores the text between them", () => {
		expect(evProse("Here we go: (+ 1 2) and that is the answer.")).toBe("3");
		expect(
			evProse("First define it.\n(defun sq (x) (* x x))\nThen use it: (sq 5)"),
		).toBe("25");
	});

	it("ignores punctuation that would otherwise be read as code", () => {
		expect(evProse("(+ 1 2) happy to help :)")).toBe("3");
		expect(evProse("a stray ) close paren is just text (+ 1 2)")).toBe("3");
		expect(evProse("don't worry about apostrophes (+ 1 2)")).toBe("3");
	});

	it("evaluates a program with no form at all to nothing", () => {
		expect(evProse("just thinking out loud, no code here")).toBe(
			"#<unspecified>",
		);
		expect(evProse("")).toBe("#<unspecified>");
	});

	it("treats a bare top-level atom as prose", () => {
		expect(evProse("16")).toBe("#<unspecified>");
		expect(evProse("no-such-var")).toBe("#<unspecified>");
	});

	it("keeps reader sugar written against a top-level form", () => {
		expect(evProse("the list is '(1 2 3)")).toBe("(1 2 3)");
		expect(evProse("(setq x 2) quasiquoted: `(1 ,x)")).toBe("(1 2)");
	});

	it("does not read prose punctuation touching a form as sugar", () => {
		expect(stripProse("and then,(+ 1 2)")).toBe("         (+ 1 2)");
	});

	it("does not end a form at a paren inside a string", () => {
		expect(
			evWithOutput('look: (echo "(not a form)") done', proseInterp()).output,
		).toBe("(not a form)\n");
	});

	it("reports syntax errors at their line in the original text", () => {
		expect(checkSyntax("some prose\nmore prose\n(a . )")).toEqual([
			{ message: 'syntax error: unexpected ")" at 3', line: 3 },
		]);
		expect(checkSyntax("prose only, and a smiley :)")).toEqual([]);
	});
});

describe("no comment syntax", () => {
	it("reads `;` as an ordinary symbol character inside a form", () => {
		expect(ev("(progn ';)")).toBe(";");
		expect(() => ev("(list 1 ; 2)")).toThrow(/void variable/);
	});

	it("ignores a `;` line outside a form, like any other prose", () => {
		expect(evProse(";; a section header\n(+ 1 2)")).toBe("3");
	});
});

describe("tolerant prose (an LLM's parentheses)", () => {
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
		expect(skipped).toHaveLength(1);
	});

	it("reads a form it cannot parse as prose", () => {
		const { value, skipped } = tolerantly(
			"And others (including a deprecated `read_file`).\n(+ 1 2)",
		);
		expect(value).toBe("3");
		expect(skipped).toHaveLength(1);
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

		it.each([
			"(2 agents, 10 MB storage)",
			"(car, cdr and cons return values)",
			"(50 GB, 12 seats, no support)",
		])("reads %s as a phrase, though no head could say so", (text) => {
			const { value, skipped } = tolerantly(text);
			expect(value).toBe("#<unspecified>");
			expect(skipped).toHaveLength(1);
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

	it("reads the text as plain lisp without the prose extension", () => {
		const bare = freshInterp();
		const skipped = collectSkips(bare);
		expect(str(runSync(bare, "(+ 1 2)"))).toBe("3");
		expect(() => runSync(bare, "(see below)")).toThrow(/undefined: see/);
		expect(() => runSync(bare, "Here we go: (+ 1 2)")).toThrow(
			/void variable: Here/,
		);
		expect(() => runSync(bare, "a stray (paren\n(+ 1 2)")).toThrow();
		expect(() => runSync(bare, "(+ 1 2")).toThrow();
		expect(skipped).toEqual([]);
	});

	it("only asks a host's classifier after evaluation fails", () => {
		const interp = proseInterp({
			...proseHost,
			classifiers: [() => ({ reason: "everything is prose here" })],
		});
		const skipped = collectSkips(interp);
		expect(str(runSync(interp, "(+ 1 2)"))).toBe("3");
		expect(str(runSync(interp, "(missing 1 2)"))).toBe("#<unspecified>");
		expect(skipped).toHaveLength(1);
	});
});

describe("a reply cut off mid-form", () => {
	it.each([
		"(+ 1",
		'(echo "hello',
		"(defun sq (x)",
		"prose first, then (+ 1",
	])("does not end the turn on %j", async (text) => {
		expect(await endsTurn(text)).toBe(false);
	});

	it.each([
		"",
		"the sum is 3",
		"all done (see above)",
		"And others (including a deprecated `read_file`).",
	])("ends the turn on %j, which ran nothing", async (text) => {
		expect(await endsTurn(text)).toBe(true);
	});
});

describe("a second look at a form that failed", () => {
	function excusingInterp(
		...classifiers: ProseClassifier[]
	): [Interp, string[]] {
		const interp = proseInterp({ ...proseHost, classifiers });
		return [interp, collectSkips(interp)];
	}

	it("reads a failed form as prose when an async host says so", async () => {
		const [interp, skipped] = excusingInterp(async () =>
			Promise.resolve({ reason: "read as prose on a second look" }),
		);

		const outcome = await runAsync(interp, '(deploy "the thing")');

		expect(str(outcome.value)).toBe("#<unspecified>");
		expect(skipped).toHaveLength(1);
	});

	it("reads a form by the first classifier that claims it", async () => {
		const [interp, skipped] = excusingInterp(
			() => undefined,
			async () => ({ reason: "the judge classified it" }),
			() => ({ reason: "the fallback classified it" }),
		);

		await runAsync(interp, "(review this phrase)");

		expect(skipped).toHaveLength(1);
		expect(skipped[0]).toContain("the judge classified it");
		expect(skipped[0]).not.toContain("the fallback classified it");
	});

	it("raises as before when every classifier declines", async () => {
		const [interp, skipped] = excusingInterp(
			() => undefined,
			async () => undefined,
		);

		await expect(runAsync(interp, '(deploy "the thing")')).rejects.toThrow(
			/undefined/,
		);
		expect(skipped).toEqual([]);
	});

	it("keeps a failure raised under an argument, where code already ran, though the host would excuse it", async () => {
		const [interp, skipped] = excusingInterp(() => ({
			reason: "excused",
		}));
		runSync(interp, "(defun keep (x) x)");

		await expect(runAsync(interp, "(keep (nope))")).rejects.toThrow(
			/undefined/,
		);
		expect(skipped).toEqual([]);
	});

	it("keeps a failure the form's own body raised, though the host would excuse it", async () => {
		const [interp, skipped] = excusingInterp(() => ({
			reason: "excused",
		}));
		runSync(interp, "(defun boom () (nope))");

		await expect(runAsync(interp, "(boom)")).rejects.toThrow(/undefined/);
		expect(skipped).toEqual([]);
	});

	it("reads a form whose head is bound but not applicable as prose when the host says so", async () => {
		const [interp, skipped] = excusingInterp(() => ({
			reason: "read as prose",
		}));
		runSync(interp, "(setq total 3)");

		const outcome = await runAsync(interp, "(total number of things)");

		expect(str(outcome.value)).toBe("#<unspecified>");
		expect(skipped).toHaveLength(1);
	});

	it("leaves the failure alone when nothing hooks the chain", async () => {
		const interp = proseInterp();

		await expect(runAsync(interp, '(deploy "the thing")')).rejects.toThrow(
			/undefined/,
		);
	});
});

describe("a failure that is not an unresolved head is not prose", () => {
	it("lets an arity failure on a bound head through untouched", () => {
		const interp = proseInterp();
		const skipped = collectSkips(interp);
		expect(() => runSync(interp, "(car 1 2)")).toThrow(/arity/);
		expect(skipped).toEqual([]);
	});

	it("lets an argument failure on a bound head through untouched", () => {
		const interp = proseInterp();
		const skipped = collectSkips(interp);
		expect(() => runSync(interp, '(car "x")')).toThrow();
		expect(skipped).toEqual([]);
	});
});
