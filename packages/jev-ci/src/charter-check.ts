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
import {
	type CharterVerdict,
	charterReview,
	DESCRIBES,
	PERMITTED,
	ROTS,
	SURE,
} from "./charter.ts";

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

function tripped(rots: number, altitude: number): string[] {
	const gates: string[] = [];
	if (rots >= ROTS)
		gates.push(`it rots at ${sure(rots)}, at or above the ${sure(ROTS)} bar`);
	if (altitude >= DESCRIBES)
		gates.push(
			`it sits at altitude ${altitude.toFixed(2)} of 3, at or above ${DESCRIBES.toFixed(2)}`,
		);
	return gates;
}

function held(rots: number, altitude: number): string[] {
	const gates: string[] = [];
	if (rots < ROTS)
		gates.push(`it rots at ${sure(rots)}, under the ${sure(ROTS)} bar`);
	if (altitude < DESCRIBES)
		gates.push(
			`it sits at altitude ${altitude.toFixed(2)} of 3, under ${DESCRIBES.toFixed(2)}`,
		);
	return gates;
}

function verdictLines(verdict: CharterVerdict): string[] {
	const { level, kind, rots, altitude, confidence } = verdict;
	const crossed = tripped(rots, altitude);
	const standing = held(rots, altitude);
	if (level === "fail")
		return [
			`Against the charter. It reads as ${kind}, and both gates tripped: ${crossed.join("; ")}.`,
			`The altitude score is ${sure(confidence)} confident, at or above the ${sure(SURE)} bar that turns a tripped pair into a failure.`,
		];
	return [
		`Borderline, and nothing fails on it. It reads as ${kind}: ${crossed.join("; ")}.`,
		standing.length > 0
			? `The other gate held: ${standing.join("; ")}.`
			: PERMITTED.has(kind)
				? `Both gates tripped, but ${kind} is what an AGENTS.md is for, so this stays a warning.`
				: `Both gates tripped, but the altitude score is only ${sure(confidence)} confident, under the ${sure(SURE)} bar, so this stays a warning.`,
	];
}

function report(file: string, rule: Rule, verdict: CharterVerdict): void {
	const { block, level } = verdict;
	if (level === "pass") return;
	annotate(
		level === "fail" ? "error" : "warning",
		file,
		block.line,
		`charter: ${verdict.kind}`,
		[
			...verdictLines(verdict),
			"",
			`The block, under "${block.heading}":`,
			...block.text.split("\n").map((text) => `  ${text}`),
			"",
			"The change that raised it:",
			...(rule.diff.length === 0
				? ["  nothing in this diff: the block was selected by --all"]
				: rule.diff.map((text) => `  ${text}`)),
			"",
			level === "fail"
				? "The code is the only source of truth: put the constraint in a name, a type or a test, and delete the prose."
				: "Watch it. If it grows, put the constraint in a name, a type or a test and delete the prose.",
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
