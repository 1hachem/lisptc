import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { providerSpecs } from "@repo/env/providers";
import ts from "typescript";

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const MODEL = "~typesafe/jev-latest";
const JOBS = 8;
const ATTEMPTS = 4;
const BACKOFF_MS = 800;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 529]);
const FAIL = 0.7;
const WARN = 0.5;
const BODY_LIMIT = 6000;
const TEST_FILES = ["*.test.ts", "*.test.tsx", "*.spec.ts", "*.spec.tsx"];

const PURPOSE =
	"A test in this repository pins behaviour, never the implementation. It drives what a caller drives: Lisp source through the REPL, a UI through what a user does to it, the chat loop through the messages it is sent, an HTTP route, a Convex function through `api`. It asserts what that caller gets back: the value, the error it can tell apart, the text a user reads, the row read back through a public query. A fake standing in for a port may have the call it receives asserted, because that call is the extension's output.";

const QUESTIONS = {
	heavily_mocked: {
		type: "noul",
		instructions:
			"Does `test.body`, with `test.setup`, replace most of what it claims to exercise with mocks, spies or stubs, so that little real code runs between its input and its assertion?",
		criteria: {
			true: "vi.mock, vi.fn, spyOn or hand-written fakes stand in for the module under test or its direct collaborators, and the assertion mostly reads back what a fake returned",
			false:
				"The real code runs end to end; any fake stands in only for the world outside the process (a port, the network, the clock, a model)",
		},
	},
	set_up_for_success: {
		type: "noul",
		instructions:
			"Is `test.body` set up so it cannot fail for a real defect: its expected value is fed in by its own setup, computed the way the code computes it, or its assertion is trivially true?",
		criteria: {
			true: "The expected value is the fixture echoed back, a constant compared with itself, a re-implementation of the code under test, or an assertion like toBeDefined that any output satisfies",
			false:
				"The expected value is written out independently, and a plausible bug in the code would make the assertion fail",
		},
	},
	pins_implementation: {
		type: "noul",
		instructions:
			"Does `test.body` assert how the code works rather than what a caller observes, by `test_purpose`?",
		criteria: {
			true: "It asserts call counts or arguments of internal mocks, prompt or message wording, markup shape, class names, data-* attributes, raw stored rows, private fields or helpers, or an internal data shape the caller never reads",
			false:
				"It asserts only what a caller of a public surface gets back, or the call a port fake receives when that call is the output",
		},
	},
	declarative_behaviour: {
		type: "noul",
		instructions:
			"Is `test.body` a declarative input to output check over a public surface: Lisp source in and its value or error out, or an interface (UI, chat loop, HTTP route, Convex api, LSP or MCP protocol) driven from outside with its visible result asserted?",
	},
} as const;

type Verdict = keyof typeof QUESTIONS;
const FAULTS = [
	"heavily_mocked",
	"set_up_for_success",
	"pins_implementation",
] as const satisfies Verdict[];

interface Case {
	file: string;
	line: number;
	end: number;
	suite: string[];
	title: string;
	body: string;
	setup: string;
}

interface Judged extends Case {
	answers: Record<Verdict, number>;
}

function git(...args: string[]): string {
	return execFileSync("git", args, {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

function argValue(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	return i === -1 ? undefined : process.argv[i + 1];
}

function isTestCall(node: ts.CallExpression, names: Set<string>): boolean {
	let e: ts.Expression = node.expression;
	while (ts.isCallExpression(e) || ts.isPropertyAccessExpression(e)) {
		if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression))
			return names.has(e.expression.text);
		e = e.expression;
	}
	return ts.isIdentifier(e) && names.has(e.text);
}

const TESTS = new Set(["it", "test"]);
const SUITES = new Set(["describe", "suite"]);
const SETUP = new Set(["beforeEach", "beforeAll"]);

function casesOf(file: string): Case[] {
	const source = readFileSync(file, "utf8");
	const sf = ts.createSourceFile(
		file,
		source,
		ts.ScriptTarget.Latest,
		true,
		file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const lineOf = (pos: number) =>
		sf.getLineAndCharacterOfPosition(pos).line + 1;
	const textOf = (node: ts.Node) => node.getText(sf);
	const titleOf = (arg: ts.Expression | undefined) =>
		arg && ts.isStringLiteralLike(arg) ? arg.text : arg ? textOf(arg) : "";
	const mocks = sf.statements
		.filter(
			(s) =>
				ts.isExpressionStatement(s) &&
				ts.isCallExpression(s.expression) &&
				/^vi\.(mock|hoisted)/.test(textOf(s.expression.expression)),
		)
		.map(textOf);
	const cases: Case[] = [];
	const walk = (node: ts.Node, suite: string[], setup: string[]) => {
		if (ts.isCallExpression(node) && node.arguments.length > 0) {
			if (isTestCall(node, SUITES)) {
				const inner = [...suite, titleOf(node.arguments[0])];
				const body = node.arguments[1];
				const hooks: string[] = [];
				if (body)
					body.forEachChild(function find(child) {
						if (
							ts.isCallExpression(child) &&
							ts.isIdentifier(child.expression) &&
							SETUP.has(child.expression.text)
						)
							hooks.push(textOf(child));
						else if (!ts.isCallExpression(child)) child.forEachChild(find);
					});
				for (const arg of node.arguments.slice(1))
					arg.forEachChild((c) => walk(c, inner, [...setup, ...hooks]));
				return;
			}
			if (isTestCall(node, TESTS)) {
				cases.push({
					file,
					line: lineOf(node.getStart(sf)),
					end: lineOf(node.getEnd()),
					suite,
					title: titleOf(node.arguments[0]),
					body: textOf(node).slice(0, BODY_LIMIT),
					setup: [...mocks, ...setup].join("\n\n").slice(0, BODY_LIMIT),
				});
				return;
			}
		}
		node.forEachChild((c) => walk(c, suite, setup));
	};
	walk(sf, [], []);
	return cases;
}

function addedLines(base: string, file: string): Set<number> {
	const lines = new Set<number>();
	for (const hunk of git("diff", "--unified=0", base, "--", file).matchAll(
		/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm,
	)) {
		const start = Number(hunk[1]);
		const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
		for (let n = start; n < start + count; n++) lines.add(n);
	}
	return lines;
}

function inScope(all: boolean, base: string): Case[] {
	if (all)
		return git("ls-files", ...TEST_FILES)
			.split("\n")
			.filter(Boolean)
			.flatMap(casesOf);
	const mergeBase = git("merge-base", base, "HEAD").trim();
	return git(
		"diff",
		"--name-only",
		"--diff-filter=d",
		mergeBase,
		"--",
		...TEST_FILES,
	)
		.split("\n")
		.filter(Boolean)
		.flatMap((file) => {
			const added = addedLines(mergeBase, file);
			return casesOf(file).filter((c) =>
				[...added].some((n) => n >= c.line && n <= c.end),
			);
		});
}

async function decide(
	apiKey: string,
	c: Case,
): Promise<Record<Verdict, number>> {
	const body = JSON.stringify({
		model: MODEL,
		state: {
			test_purpose: PURPOSE,
			test: {
				file: c.file,
				suite: c.suite.join(" > "),
				title: c.title,
				setup: c.setup,
				body: c.body,
			},
		},
		questions: QUESTIONS,
	});
	for (let attempt = 1; ; attempt++) {
		const res = await fetch(ENDPOINT, {
			method: "POST",
			headers: {
				authorization: `Bearer ${apiKey}`,
				"content-type": "application/json",
			},
			body,
		});
		if (res.ok) {
			const { answers } = (await res.json()) as {
				answers: Record<string, { noul?: number }>;
			};
			return Object.fromEntries(
				Object.keys(QUESTIONS).map((id) => {
					const noul = answers[id]?.noul;
					if (typeof noul !== "number") throw new Error(`no answer to ${id}`);
					return [id, noul];
				}),
			) as Record<Verdict, number>;
		}
		if (!RETRYABLE.has(res.status) || attempt >= ATTEMPTS)
			throw new Error(`${res.status} ${await res.text()}`);
		await new Promise((r) => setTimeout(r, BACKOFF_MS * 2 ** (attempt - 1)));
	}
}

async function judgeAll(apiKey: string, cases: Case[]): Promise<Judged[]> {
	const judged: Judged[] = [];
	let next = 0;
	const worker = async () => {
		while (next < cases.length) {
			const c = cases[next++];
			judged.push({ ...c, answers: await decide(apiKey, c) });
			if (judged.length % 100 === 0)
				console.error(`judged ${judged.length}/${cases.length}`);
		}
	};
	await Promise.all(Array.from({ length: JOBS }, worker));
	return judged.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

const fails = (j: Judged) => FAULTS.some((f) => j.answers[f] >= FAIL);
const warns = (j: Judged) =>
	!fails(j) &&
	(FAULTS.some((f) => j.answers[f] >= WARN) ||
		j.answers.declarative_behaviour < 1 - WARN);

function report(j: Judged): string {
	const flagged = FAULTS.filter((f) => j.answers[f] >= WARN)
		.map((f) => `${f.replaceAll("_", " ")} ${j.answers[f].toFixed(2)}`)
		.concat(
			j.answers.declarative_behaviour < 1 - WARN
				? [`declarative ${j.answers.declarative_behaviour.toFixed(2)}`]
				: [],
		);
	return `${j.file}:${j.line}  ${j.title}\n    ${flagged.join(", ")}`;
}

const apiKey = providerSpecs.openrouter.apiKey;
if (!apiKey) {
	console.error(
		"No OPENROUTER_API_KEY. Run it as `task check:tests`, which fetches the key from Infisical.",
	);
	process.exit(2);
}

const cases = inScope(
	process.argv.includes("--all"),
	argValue("--base") ?? "origin/main",
);
if (cases.length === 0) {
	console.log("No test case added or changed.");
	process.exit(0);
}

const judged = await judgeAll(apiKey, cases);
const out = argValue("--json");
if (out)
	writeFileSync(out, JSON.stringify(judged.map(({ body, setup, ...j }) => j)));

const failed = judged.filter(fails);
const warned = judged.filter(warns);
for (const j of warned) console.log(`warn  ${report(j)}`);
for (const j of failed) console.log(`FAIL  ${report(j)}`);
console.log(
	`${judged.length} test case${judged.length === 1 ? "" : "s"} judged: ${failed.length} failed, ${warned.length} warned.`,
);
if (failed.length > 0) {
	console.log(
		"A failed case mocks what it tests, cannot fail, or pins the implementation. Rewrite it to drive a public surface and assert what the caller gets back, or delete it.",
	);
	process.exit(1);
}
