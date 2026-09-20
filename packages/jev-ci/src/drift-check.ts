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
	resolve,
	touched,
} from "./agents-host.ts";
import { type Block, chunk, mentions } from "./blocks.ts";
import {
	CONTRADICTED,
	type DriftVerdict,
	driftJudge,
	driftRouter,
	type Evidence,
	type Mention,
	SUFFICIENT,
} from "./drift.ts";

const MOST = 25;

const base = flag("base", "origin/main");
const all = has("all");
const allow = has("allow");

interface Rule {
	block: Block;
	tokens: string[];
	diff: string[];
}

interface Judged {
	file: string;
	rule: Rule;
	evidence: Evidence[];
	verdict: DriftVerdict;
}

function sure(odds: number): string {
	return `${Math.round(odds * 100)}%`;
}

function rules(file: string): Rule[] {
	const found: Hunk[] = all ? [] : hunks(base, file);
	const added = addedLines(found);
	return chunk(read(file))
		.map((block) => ({
			block,
			tokens: mentions(block),
			diff: patch(block, found),
		}))
		.filter(
			(one) => one.tokens.length > 0 && (all || touched(one.block, added)),
		);
}

function cure(drift: DriftVerdict["drift"]): string {
	return drift === "deleted" || drift === "absent"
		? "There is nothing left to point at. Delete the sentence."
		: "Fix the sentence, or move the constraint into a check that fails.";
}

function report(one: Judged): void {
	const { file, rule, evidence, verdict } = one;
	const { block, level, drift, weight, contradicted, sufficient } = verdict;
	if (level === "holds") return;
	if (level === "unanchored") {
		annotate("notice", file, block.line, "charter: unanchored", [
			"No evidence in the repository can confirm or deny this block. Nothing falsifies it, which is what the charter forbids.",
		]);
		return;
	}
	if (level === "unchecked") {
		annotate("notice", file, block.line, "drift: could not check", [
			`This block looks contradicted (${sure(contradicted)}) but the evidence gathered settles it only at ${sure(sufficient)}, under the ${sure(SUFFICIENT)} bar. Needs a human.`,
		]);
		return;
	}
	annotate("error", file, block.line, `drift: ${drift}`, [
		`The code contradicts this block, and jev is ${sure(contradicted)} sure of it. The bar is ${sure(CONTRADICTED)}.`,
		`The evidence settles it at ${sure(sufficient)}. An agent that believes the block scores ${weight.toFixed(2)} of 3 for harm.`,
		"",
		`The block, under "${block.heading}":`,
		...block.text.split("\n").map((text) => `  ${text}`),
		"",
		"The change that raised it:",
		...(rule.diff.length === 0
			? ["  nothing in this diff: the block was selected by --all"]
			: rule.diff.map((text) => `  ${text}`)),
		"",
		"What the repository says now:",
		...evidence.map((it) => `  ${it.token} (${it.kind}): ${it.found}`),
		"",
		cure(drift),
	]);
}

const work = (all ? charterFiles() : changedCharter(base)).map((file) => ({
	file,
	rules: rules(file),
}));
const total = work.reduce((sum, one) => sum + one.rules.length, 0);

if (total === 0) {
	console.log("No changed charter block points at anything in the code.");
	process.exit(0);
}

if (!jevConfigured) {
	console.log(
		`::notice::${total} block(s) went unchecked for drift: neither JEV_API_KEY nor OPENROUTER_API_KEY is set.`,
	);
	process.exit(0);
}

const router = driftRouter();
const judge = driftJudge();
const judged: Judged[] = [];

for (const { file, rules: found } of work) {
	if (found.length === 0) continue;
	const asking = found.slice(0, MOST);
	if (found.length > MOST)
		console.log(
			`::notice file=${file}::checking the first ${MOST} of ${found.length} changed blocks.`,
		);
	const flat: Mention[] = asking.flatMap((one) =>
		one.tokens.map((token) => ({ block: one.block.id, token })),
	);
	const routes = await router(
		file,
		asking.map((one) => one.block),
		flat,
	);
	let at = 0;
	for (const rule of asking) {
		const evidence = rule.tokens.flatMap((token) =>
			resolve(token, routes[at++] ?? ["none"]),
		);
		if (evidence.length === 0) continue;
		const verdict = await judge(file, rule.block, evidence);
		if (verdict !== undefined) judged.push({ file, rule, evidence, verdict });
	}
}

for (const one of judged) report(one);

const drifted = judged.filter((one) => one.verdict.level === "drift");

console.log(
	`Checked ${judged.length} changed block(s) against the code: ${drifted.length} drifted at or above ${sure(CONTRADICTED)} confidence.`,
);

for (const { file, verdict } of drifted)
	console.log(
		`  ${file}:${verdict.block.line} ${verdict.drift} (${sure(verdict.contradicted)}) — ${verdict.block.heading}`,
	);

if (drifted.length > 0 && !allow) process.exit(1);
