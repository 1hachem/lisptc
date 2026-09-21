import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const MODEL = "~typesafe/jev-latest";

const CONCURRENCY = 4;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 529]);
const ATTEMPTS = 4;
const BACKOFF_MS = 800;

const FAIL_IMPLEMENTATION = 2.2;
const WARN_IMPLEMENTATION = 1.6;
const FAIL_PROBABILITY = 0.7;
const OVERRIDE_PROBABILITY = 0.85;
const WARN_PROBABILITY = 0.5;

const NOT_IMPLEMENTATION = new Set([
	"rule",
	"placement",
	"pointer",
	"editorial",
]);

const FILE_PURPOSE =
	"An AGENTS.md in this monorepo holds the rules a coding agent works under: how things are interfaced, which way dependencies run, where a thing belongs. It points the agent at the files, packages, commands and exported names it will need, and says in a phrase what each one is for. That is wanted. What it must never do is say how any of them works: the steps, the order they run in, the data that moves and what happens at runtime are read in the code, because prose rots and the code does not.";

type NoulQuestion = {
	type: "noul";
	instructions: string;
	criteria: { true: string; false: string };
};

type ChoiceQuestion = {
	type: "choice";
	instructions: string;
	criteria: Record<string, string>;
};

type ScoreQuestion = {
	type: "score";
	instructions: string;
	criteria: string[];
};

type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

const IMPLEMENTATION: ScoreQuestion = {
	type: "score",
	instructions:
		"Where does `added_lines` sit between saying what something is and explaining how it works? Naming a file, a package, a command or an exported name, and saying in a phrase what it is for, counts as saying what it is. Read `paragraph` and `section` as context, and judge `added_lines`.",
	criteria: [
		"A rule, a boundary, or a statement of where a thing belongs. It tells the reader what to do or not do, or which way a dependency runs, and points at nothing in particular.",
		"A map or a pointer. It names files, packages, paths, commands, scripts or exported names, and gives each one a phrase saying what it is for. It says what a thing is, never how it does it.",
		"It goes past what a thing is for and into what it is made of: the fields it carries, the arguments it takes, what comes back from it, the shape of a type, or the conditions under which a case applies.",
		"It walks through how the code works while it runs: the steps it takes, the order they happen in, what it does with the data that passes through it, or what happens when it is called. None of these is this: listing the commands a tool runs in the order it runs them, saying what a command does when a person runs it, or describing what the product is and what someone gets out of using it.",
	],
};

const MECHANISM: NoulQuestion = {
	type: "noul",
	instructions:
		"Does `added_lines` explain how something works, rather than what it is for?",
	criteria: {
		true: "It walks through what the code does while it runs: the steps it takes, the order they happen in, what it does with the data that passes through it, or the conditions under which one case is taken instead of another.",
		false:
			"It names things and says what each one is for, or it states a rule, a constraint or a boundary, and leaves the workings to be read in the code. None of these counts as an explanation: a phrase giving a file's or a symbol's job; a list of the commands or checks a tool runs and the order it runs them in; what a command does when a person runs it; a sentence describing what the product is, who uses it and what they get out of it; or an account of how a tool or a test behaved.",
	},
};

const SYMBOLS: NoulQuestion = {
	type: "noul",
	instructions:
		"Does `added_lines` name an identifier that exists in the source code, such as a type, a function, a class, a method, a variable, a field, an exported name, or a signature?",
	criteria: {
		true: "At least one such identifier appears, however it is spelled or quoted.",
		false:
			"The only concrete names are packages, directories, file paths, package scripts, shell commands, configuration keys, environment variables, or tool names. None of those is a source identifier.",
	},
};

const RATIONALE: NoulQuestion = {
	type: "noul",
	instructions:
		"Does `added_lines` explain why something was designed or decided the way it is, instead of stating the rule that came out of the decision?",
	criteria: {
		true: "It gives a history, an alternative that was rejected, a tradeoff that was weighed, or a justification that reads as a design note.",
		false:
			"It states the rule or the boundary. A short clause that makes the rule's meaning or its stakes precise is not a design note.",
	},
};

const KIND: ChoiceQuestion = {
	type: "choice",
	instructions: "What does `added_lines` do?",
	criteria: {
		rule: "States something the reader must or must not do, or a constraint the repository holds itself to.",
		placement:
			"Says where a thing belongs, which package owns it, or which way a dependency is allowed to run.",
		pointer:
			"Names files, packages, commands, scripts or exported names and gives each one a phrase saying what it is for. A map of what lives where is a pointer.",
		mechanism:
			"Describes how something works: the steps, the order, the data that moves, the internal shape of a type or a function.",
		rationale:
			"Explains why a decision was made, what was tried before, or what the tradeoffs were.",
		editorial:
			"Rewords, reformats, or relocates existing text without adding a claim.",
	},
};

const SCOPE: NoulQuestion = {
	type: "noul",
	instructions:
		"Does `added_lines` state a rule that governs one single package or app, rather than the whole repository?",
	criteria: {
		true: "It only makes sense for one package or app, so it belongs in that package's own AGENTS.md.",
		false:
			"It applies repository-wide, or it describes how packages relate to one another.",
	},
};

type Answer = {
	noul?: number;
	choice?: string;
	score?: number;
	confidence?: number;
};

type Decision = { answers: Record<string, Answer> };

type Block = {
	file: string;
	line: number;
	section: string;
	paragraph: string;
	added: string;
	root: boolean;
};

type Judged = Block & {
	implementation: number;
	confidence: number;
	mechanism: number;
	symbols: number;
	rationale: number;
	kind: string;
	scope: number;
};

function git(args: string[]): string {
	return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 26 });
}

function argValue(flag: string, fallback: string): string {
	const at = process.argv.indexOf(flag);
	return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

function agentsFiles(out: string): string[] {
	return out
		.split("\n")
		.filter(Boolean)
		.filter((file) => basename(file) === "AGENTS.md");
}

function trackedFiles(): string[] {
	return agentsFiles(git(["ls-files", "--", "*AGENTS.md"]));
}

function changedFiles(base: string): string[] {
	return agentsFiles(
		git(["diff", "--name-only", "--diff-filter=d", base, "--", "*AGENTS.md"]),
	);
}

function addedLineNumbers(base: string, file: string): Set<number> {
	const out = git(["diff", "--unified=0", base, "--", file]);
	const added = new Set<number>();
	let cursor = 0;
	for (const line of out.split("\n")) {
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
		if (hunk?.[1]) {
			cursor = Number(hunk[1]);
			continue;
		}
		if (line.startsWith("+++")) continue;
		if (line.startsWith("+")) {
			added.add(cursor);
			cursor += 1;
		}
	}
	return added;
}

function isHeading(line: string): boolean {
	return /^#{1,6}\s/.test(line);
}

function blocksOf(file: string, isNew: (line: number) => boolean): Block[] {
	const lines = readFileSync(file, "utf8").split("\n");
	const root = file === "AGENTS.md";
	const blocks: Block[] = [];
	let section = "";
	let fenced = false;
	let start = -1;

	const flush = (end: number) => {
		if (start === -1) return;
		const range = lines.slice(start - 1, end);
		const numbers = range.map((_, index) => start + index);
		const news = numbers.filter(isNew);
		const first = start;
		start = -1;
		if (news.length === 0) return;
		const paragraph = range.join("\n").trim();
		const addedText = news
			.map((n) => lines[n - 1])
			.join("\n")
			.trim();
		if (addedText === "" || range.every((line) => isHeading(line))) return;
		blocks.push({
			file,
			line: news[0] ?? first,
			section,
			paragraph,
			added: addedText,
			root,
		});
	};

	lines.forEach((line, index) => {
		const number = index + 1;
		if (/^\s*```/.test(line)) {
			flush(number - 1);
			fenced = !fenced;
			return;
		}
		if (fenced) return;
		if (line.trim() === "") {
			flush(number - 1);
			return;
		}
		if (isHeading(line)) {
			flush(number - 1);
			section = line.replace(/^#+\s*/, "").trim();
			return;
		}
		if (start === -1) start = number;
	});
	flush(lines.length);
	return blocks;
}

async function decide(
	key: string,
	model: string,
	state: unknown,
	questions: Record<string, Question>,
): Promise<Decision> {
	const body = JSON.stringify({ model, state, questions });
	let wait = BACKOFF_MS;
	for (let attempt = 1; ; attempt += 1) {
		const response = await fetch(DECISIONS_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
			},
			body,
		});
		if (response.ok) return (await response.json()) as Decision;
		if (!RETRYABLE.has(response.status) || attempt === ATTEMPTS) {
			throw new Error(
				`${model} answered ${response.status}: ${(await response.text()).slice(0, 400)}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, wait));
		wait *= 2;
	}
}

async function judge(
	key: string,
	model: string,
	block: Block,
): Promise<Judged> {
	const questions: Record<string, Question> = {
		implementation: IMPLEMENTATION,
		mechanism: MECHANISM,
		symbols: SYMBOLS,
		rationale: RATIONALE,
		kind: KIND,
	};
	if (block.root) questions.scope = SCOPE;
	const { answers } = await decide(
		key,
		model,
		{
			file_purpose: FILE_PURPOSE,
			file: block.file,
			section: block.section,
			paragraph: block.paragraph,
			added_lines: block.added,
		},
		questions,
	);
	return {
		...block,
		implementation: answers.implementation?.score ?? 0,
		confidence: answers.implementation?.confidence ?? 0,
		mechanism: answers.mechanism?.noul ?? 0,
		symbols: answers.symbols?.noul ?? 0,
		rationale: answers.rationale?.noul ?? 0,
		kind: answers.kind?.choice ?? "unknown",
		scope: answers.scope?.noul ?? 0,
	};
}

async function pool<In, Out>(
	items: In[],
	jobs: number,
	worker: (item: In) => Promise<Out>,
): Promise<Out[]> {
	const out: Out[] = new Array(items.length);
	let next = 0;
	const runner = async () => {
		while (next < items.length) {
			const at = next++;
			const item = items[at];
			if (item === undefined) continue;
			out[at] = await worker(item);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(jobs, items.length) }, runner),
	);
	return out;
}

function fails(judged: Judged): boolean {
	if (judged.mechanism >= OVERRIDE_PROBABILITY) return true;
	if (NOT_IMPLEMENTATION.has(judged.kind)) return false;
	if (judged.implementation >= FAIL_IMPLEMENTATION) return true;
	return (
		judged.mechanism >= FAIL_PROBABILITY &&
		judged.implementation >= WARN_IMPLEMENTATION
	);
}

function warns(judged: Judged): boolean {
	return (
		judged.implementation >= WARN_IMPLEMENTATION ||
		judged.mechanism >= WARN_PROBABILITY ||
		judged.symbols >= WARN_PROBABILITY ||
		judged.rationale >= FAIL_PROBABILITY ||
		judged.scope >= FAIL_PROBABILITY
	);
}

function severity(judged: Judged): number {
	return judged.implementation + Math.max(judged.mechanism, judged.symbols);
}

function report(judged: Judged): string {
	const head = `${judged.file}:${judged.line}  implementation ${judged.implementation.toFixed(2)} (confidence ${judged.confidence.toFixed(2)})  mechanism ${judged.mechanism.toFixed(2)}  identifiers ${judged.symbols.toFixed(2)}  design-note ${judged.rationale.toFixed(2)}${judged.root ? `  one-package ${judged.scope.toFixed(2)}` : ""}  kind=${judged.kind}`;
	const quoted = judged.added
		.split("\n")
		.map((line) => `    ${line}`)
		.join("\n");
	return `${head}\n${quoted}\n`;
}

const sweep = process.argv.includes("--all");
const warnOnly = process.argv.includes("--warn-only");
const jobs = Number(argValue("--jobs", String(CONCURRENCY))) || CONCURRENCY;
const base = sweep
	? ""
	: git(["merge-base", argValue("--base", "origin/main"), "HEAD"]).trim();
const only = argValue("--only", "");
const files = (sweep ? trackedFiles() : changedFiles(base)).filter(
	(file) => only === "" || file === only || file.startsWith(`${only}/`),
);

if (files.length === 0) {
	console.log(
		sweep ? "No AGENTS.md tracked." : "No AGENTS.md changed. Skipped.",
	);
	process.exit(0);
}

const blocks = files.flatMap((file) => {
	if (sweep) return blocksOf(file, () => true);
	const added = addedLineNumbers(base, file);
	return blocksOf(file, (line) => added.has(line));
});

if (blocks.length === 0) {
	console.log(`${files.length} AGENTS.md, no prose to judge. Skipped.`);
	process.exit(0);
}

if (process.argv.includes("--print")) {
	for (const block of blocks) {
		console.log(
			JSON.stringify(
				{
					file: block.file,
					line: block.line,
					section: block.section,
					paragraph: block.paragraph,
					added_lines: block.added,
				},
				null,
				2,
			),
		);
	}
	console.log(`${blocks.length} blocks in ${files.length} AGENTS.md.`);
	process.exit(0);
}

// biome-ignore lint/style/noProcessEnv: a root script reads the environment it is handed, it belongs to no package
const key = process.env.OPENROUTER_API_KEY;

if (key === undefined || key === "") {
	console.error(
		"OPENROUTER_API_KEY is unset. The /ai secrets carry it: run this under `task` locally, or through the Infisical step in CI.",
	);
	process.exit(1);
}

const model = argValue("--model", MODEL);
const judgements = await pool(blocks, jobs, (block) =>
	judge(key, model, block),
);

const failed = judgements
	.filter(fails)
	.sort((a, b) => severity(b) - severity(a));
const warned = judgements
	.filter((j) => !fails(j) && warns(j))
	.sort((a, b) => severity(b) - severity(a));

for (const judged of failed) console.error(report(judged));
for (const judged of warned) console.warn(report(judged));

if (sweep) {
	for (const file of files) {
		const mine = judgements.filter((j) => j.file === file);
		const bad = mine.filter(fails).length;
		const soft = mine.filter((j) => !fails(j) && warns(j)).length;
		console.log(
			`${file}  ${mine.length} blocks, ${bad} failing, ${soft} warning`,
		);
	}
}

if (failed.length === 0) {
	console.log(
		`${blocks.length} block${blocks.length === 1 ? "" : "s"} in ${files.length} AGENTS.md, none carrying implementation detail.`,
	);
	process.exit(0);
}

console.error(
	`${failed.length} block${failed.length === 1 ? "" : "s"} carry implementation detail.`,
);
console.error("");
console.error(
	"An AGENTS.md holds rules, not implementation. A name, a step or",
);
console.error(
	"a data flow written here rots the moment the code moves. Put the",
);
console.error(
	"constraint in a name, a type or a test, and leave the prose with",
);
console.error("the rule, the boundary, or where the thing belongs.");
process.exit(warnOnly ? 0 : 1);
