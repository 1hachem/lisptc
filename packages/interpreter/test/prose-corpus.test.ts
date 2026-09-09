import { describe, expect, it } from "vitest";
import { MODEL } from "../src/channels.ts";
import {
	checkSyntax,
	Interp,
	prelude,
	runSync,
	setWriter,
	str,
} from "../src/lisp.ts";
import { proseExtension } from "../src/prose.ts";

type Run = { value: string; output: string; skipped: string[] };

function tolerantly(text: string): Run {
	const interp = new Interp({ extensions: [proseExtension()] });
	runSync(interp, prelude);
	const skipped: string[] = [];
	interp.channels.on(MODEL, (d) => {
		if (d.severity === "warning") skipped.push(d.text);
	});
	let output = "";
	const previous = setWriter((s) => {
		output += s;
	});
	try {
		return { value: str(runSync(interp, text)), output, skipped };
	} finally {
		setWriter(previous);
	}
}

const NOTHING = "#<unspecified>";

const POINTERS = [
	"(see below)",
	"(see above)",
	"(for example)",
	"(e.g. see below)",
	"(i.e. the sum)",
	"(cf. above)",
	"(n.b. this is fine)",
	"(a.k.a. the REPL)",
	"(P.S. this is prose)",
	"(TODO: fix this)",
	"(note: the REPL prints nothing)",
	"(re: your question)",
	"(more on this later)",
];

const QUANTITIES = [
	"(3)",
	"(10 MB)",
	"(1 hour)",
	"(30 seconds)",
	"(2 agents)",
	"(5 GB storage)",
	"(100 credits)",
	"(3 of 5)",
	"(step 2)",
	"(50% done)",
	"(~40 lines)",
	"(≈100 ms)",
	"(about 2x faster)",
	"(#1 priority)",
	"(20-30 min)",
	"(1/3 done)",
	"(€49.99/month)",
	"(v1.2.3)",
	"(2026-09-09)",
];

const CLAUSES = [
	"(one, two, three)",
	"(1, 2, 3)",
	"(first, second)",
	"(2 agents, 10 MB storage, 100 credits)",
	"(5 agents, 5 GB storage, 1,000 credits)",
	"(Unlimited agents, 15 GB storage, 5,000 credits)",
	"(4 GB RAM, 2 vCPU)",
	"(90% of the time, this works)",
	"(2 of the 3 servers, both regions)",
	"(Smith et al., 2020)",
	"(step 1: load, step 2: run)",
];

const SENTENCES = [
	"(the quick brown fox jumps over the lazy dog)",
	"(the result is 42)",
	"(pick one: A, B or C)",
	"(Free tier: 2 agents)",
	"(Lisp (the language) is old)",
	"(see the Lisp_(programming_language) page)",
	"(A/B test)",
	"(GET /api/chat)",
	"(see https://example.com)",
	"(https://example.com)",
	"(Q&A)",
	"(🙂)",
	"(!)",
	"(?)",
	"(...)",
	"(x)",
	"(yes)",
	"(a — b)",
	'("quoted")',
];

const REPLIES: [source: string, value: string][] = [
	["Let me square it: (* 5 5)", "25"],
	["(defun sq (x) (* x x))\nnow use it: (sq 5)", "25"],
	[
		'The plan is PRO: (setq plan "PRO")\nso the credits are (if (equal plan "PRO") 5000 100)',
		"5000",
	],
	['(list "one, two, three")', '("one, two, three")'],
	['(string-split "a, b, c" ", ")', '("a" "b" "c")'],
	['(string-join (list "PRO" "DIY") ", ")', '"PRO, DIY"'],
	["(mapcar (lambda (x) (* x 2)) '(1 2 3))", "(2 4 6)"],
	['(cdr (assoc "title" (list (cons "title" "Fix auth"))))', '"Fix auth"'],
	["(let ((agents 2) (storage 10)) (+ agents storage))", "12"],
	["(car '(one two three))", "one"],
	["(length '(1 2 3))", "3"],
	["((lambda (x) (* x 2)) 21)", "42"],
	["(defun see (x) (* x 2))\nand now (see 21)", "42"],
	["(setq credits 100)\n(setq storage 10)\n(+ credits storage)", "110"],
];

const MIXED: [source: string, value: string, skips: number][] = [
	["Here is the plan (see below):\n(+ 1 2)", "3", 1],
	["Free: €0 (2 agents, 10 MB storage, 100 credits)\nso: (* 2 10)", "20", 1],
	["I will check the docs (later) and then (+ 1 2)", "3", 1],
	["(+ 1 2) — done (finally)", "3", 1],
	["one aside (see below)\nanother (see above)\n(+ 1 2)", "3", 2],
];

const CALLS: [source: string, name: string][] = [
	['(server/tool :key "value")', "server/tool"],
	["(server/tool)", "server/tool"],
	['(linear/list-issues :query "auth bug")', "linear/list-issues"],
	["(browser_close)", "browser_close"],
	["(node_modules)", "node_modules"],
	["(step_two)", "step_two"],
	["(status :ok)", "status"],
	['(navigate :key "value")', "navigate"],
	['(steps "one, two, three")', "steps"],
	['(join "a" "," "b")', "join"],
	["(fetch (car urls))", "fetch"],
	['(report "a, b, c" x y z)', "report"],
];

describe("prose corpus: text a model writes around its code", () => {
	it.each(POINTERS)("runs nothing for the aside %s", (text) => {
		const { value, skipped } = tolerantly(text);
		expect(value).toBe(NOTHING);
		expect(skipped).toHaveLength(1);
	});

	it.each(QUANTITIES)("runs nothing for the quantity %s", (text) => {
		const { value, skipped } = tolerantly(text);
		expect(value).toBe(NOTHING);
		expect(skipped).toHaveLength(1);
	});

	it.each(CLAUSES)("runs nothing for the comma-separated %s", (text) => {
		const { value, skipped } = tolerantly(text);
		expect(value).toBe(NOTHING);
		expect(skipped).toHaveLength(1);
	});

	it.each(SENTENCES)("runs nothing for the sentence %s", (text) => {
		const { value, skipped } = tolerantly(text);
		expect(value).toBe(NOTHING);
		expect(skipped).toHaveLength(1);
	});

	it("reads a whole price list as prose", () => {
		const { value, skipped } = tolerantly(
			[
				"Here are the tiers:",
				"",
				"Free: €0 (2 agents, 10 MB storage, 100 credits)",
				"DIY: €49.99/month (5 agents, 5 GB storage, 1,000 credits)",
				"PRO: €199.99/month (Unlimited agents, 15 GB storage, 5,000 credits)",
			].join("\n"),
		);
		expect(value).toBe(NOTHING);
		expect(skipped).toHaveLength(3);
	});

	it("finds no syntax error in any of it", () => {
		for (const text of [...POINTERS, ...QUANTITIES, ...CLAUSES, ...SENTENCES])
			expect(checkSyntax(text)).toEqual([]);
	});
});

describe("prose corpus: lisptc that reads like English", () => {
	it.each(REPLIES)("evaluates %j to %s, skipping nothing", (source, value) => {
		const run = tolerantly(source);
		expect(run.value).toBe(value);
		expect(run.skipped).toEqual([]);
	});

	it("keeps a parenthesised phrase that lives inside a string", () => {
		const run = tolerantly(
			'(echo "Free: €0 (2 agents, 10 MB storage, 100 credits)")',
		);
		expect(run.output).toBe(
			"Free: €0 (2 agents, 10 MB storage, 100 credits)\n",
		);
		expect(run.skipped).toEqual([]);
	});

	it("keeps a call whose head is a word an aside would use", () => {
		expect(tolerantly('(concat "see" " below")').value).toBe('"see below"');
	});

	it.each(
		MIXED,
	)("runs the code in %j and skips the rest", (source, value, skips) => {
		const run = tolerantly(source);
		expect(run.value).toBe(value);
		expect(run.skipped).toHaveLength(skips);
	});
});

describe("prose corpus: what must stay a call", () => {
	it.each(CALLS)("reports %j as undefined: %s", (source, name) => {
		expect(() => tolerantly(source)).toThrow(`undefined: ${name}`);
	});

	it("reports an undefined name nested in a real call", () => {
		expect(() => tolerantly("(+ 1 (nope 2))")).toThrow(/undefined: nope/);
	});
});

describe("prose corpus: the frontier", () => {
	it.each([
		"(lenght '(1 2 3))",
		"(sq 5)",
		"(++ 1 2)",
	])("cannot tell %s from a turn of phrase, and says so", (text) => {
		const { value, skipped } = tolerantly(text);
		expect(value).toBe(NOTHING);
		expect(skipped[0]).toMatch(/is not defined/);
	});

	it.fails.each([
		"(and so on)",
		"(or so)",
		"(not really)",
		"(if needed)",
		"(list of issues)",
		"(last week)",
		"(read the docs)",
	])("still evaluates %s, because its head is bound", (text) => {
		expect(tolerantly(text).value).toBe(NOTHING);
	});
});
