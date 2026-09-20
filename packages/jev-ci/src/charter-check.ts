import { jevConfigured } from "@repo/env/decisions";
import {
	addedLines,
	annotate,
	changedCharter,
	charterFiles,
	flag,
	type Hunk,
	has,
	hunks,
	patch,
	read,
	touched,
} from "./agents-host.ts";
import { type Block, chunk } from "./blocks.ts";
import { type CharterVerdict, charterReview, SURE } from "./charter.ts";

const MOST = 40;

const base = flag("base", "origin/main");
const all = has("all");
const allow = has("allow");

interface Rule {
	block: Block;
	diff: string[];
}

function sure(odds: number): string {
	return `${Math.round(odds * 100)}%`;
}

function rules(file: string): Rule[] {
	const found: Hunk[] = all ? [] : hunks(base, file);
	const added = addedLines(found);
	return chunk(read(file))
		.map((block) => ({ block, diff: patch(block, found) }))
		.filter((one) => all || touched(one.block, added));
}

function report(file: string, rule: Rule, verdict: CharterVerdict): void {
	const { block, level, kind, rots, altitude, confidence } = verdict;
	if (level === "pass") return;
	annotate(
		level === "fail" ? "error" : "warning",
		file,
		block.line,
		`charter: ${kind}`,
		[
			`This block reads as ${kind}, not as a pointer or a rule, at ${sure(confidence)} confidence. The bar is ${sure(SURE)}.`,
			`It rots at ${sure(rots)} and sits at altitude ${altitude.toFixed(2)} of 3.`,
			"",
			`The rule that failed, under "${block.heading}":`,
			...block.text.split("\n").map((text) => `  ${text}`),
			"",
			"The change that failed it:",
			...(rule.diff.length === 0
				? ["  nothing in this diff: the block was selected by --all"]
				: rule.diff.map((text) => `  ${text}`)),
			"",
			"The code is the only source of truth: put the constraint in a name, a type or a test, and delete the prose.",
		],
	);
}

const work = (all ? charterFiles() : changedCharter(base)).map((file) => ({
	file,
	rules: rules(file),
}));
const total = work.reduce((sum, one) => sum + one.rules.length, 0);

if (total === 0) {
	console.log(`No new prose in ${work.length} changed charter file(s).`);
	process.exit(0);
}

if (!jevConfigured) {
	console.log(
		`::notice::${total} new block(s) went unjudged: neither JEV_API_KEY nor OPENROUTER_API_KEY is set.`,
	);
	process.exit(0);
}

const review = charterReview();
const judged: { file: string; rule: Rule; verdict: CharterVerdict }[] = [];

for (const { file, rules: found } of work) {
	if (found.length === 0) continue;
	const asking = found.slice(0, MOST);
	if (found.length > MOST)
		console.log(
			`::notice file=${file}::judging the first ${MOST} of ${found.length} changed blocks.`,
		);
	const by = new Map(asking.map((one) => [one.block.id, one]));
	for (const verdict of await review(
		file,
		asking.map((one) => one.block),
	)) {
		const rule = by.get(verdict.block.id);
		if (rule !== undefined) judged.push({ file, rule, verdict });
	}
}

for (const one of judged) report(one.file, one.rule, one.verdict);

const failed = judged.filter((one) => one.verdict.level === "fail");
const warned = judged.filter((one) => one.verdict.level === "warn");

console.log(
	`Judged ${judged.length} changed block(s): ${failed.length} against the charter, ${warned.length} borderline.`,
);

for (const { file, verdict } of failed)
	console.log(
		`  ${file}:${verdict.block.line} ${verdict.kind} (${sure(verdict.confidence)}) — ${verdict.block.heading}`,
	);

if (failed.length > 0 && !allow) process.exit(1);
