import { jevConfigured } from "@repo/env/decisions";
import {
	addedLines,
	annotate,
	charterFiles,
	flag,
	has,
	read,
	touched,
} from "./agents-host.ts";
import { type Block, chunk } from "./blocks.ts";
import { type CharterVerdict, charterReview } from "./charter.ts";

const MOST = 40;

const base = flag("base", "origin/main");
const all = has("all");
const allow = has("allow");

function selected(file: string): Block[] {
	const blocks = chunk(read(file));
	if (all) return blocks;
	const added = addedLines(base, file);
	return blocks.filter((block) => touched(block, added));
}

function report(file: string, verdict: CharterVerdict): void {
	const { block, level, kind, rots, altitude } = verdict;
	if (level === "pass") return;
	annotate(
		level === "fail" ? "error" : "warning",
		file,
		block.line,
		`charter: ${kind}`,
		[
			`This block reads as ${kind}, not as a pointer or a rule.`,
			`It rots at ${rots.toFixed(2)} and sits at altitude ${altitude.toFixed(2)} of 3.`,
			"The code is the only source of truth: put the constraint in a name, a type or a test, and delete the prose.",
			`Under: ${block.heading}`,
		].join("\n"),
	);
}

const work = charterFiles().map((file) => ({ file, blocks: selected(file) }));
const total = work.reduce((sum, one) => sum + one.blocks.length, 0);

if (total === 0) {
	console.log(`No new prose in ${work.length} charter file(s).`);
	process.exit(0);
}

if (!jevConfigured) {
	console.log(
		`::notice::${total} new block(s) went unjudged: neither JEV_API_KEY nor OPENROUTER_API_KEY is set.`,
	);
	process.exit(0);
}

const review = charterReview();
const verdicts: { file: string; verdict: CharterVerdict }[] = [];

for (const { file, blocks } of work) {
	if (blocks.length === 0) continue;
	const asking = blocks.slice(0, MOST);
	if (blocks.length > MOST)
		console.log(
			`::notice file=${file}::judging the first ${MOST} of ${blocks.length} changed blocks.`,
		);
	for (const verdict of await review(file, asking))
		verdicts.push({ file, verdict });
}

for (const { file, verdict } of verdicts) report(file, verdict);

const failed = verdicts.filter(({ verdict }) => verdict.level === "fail");
const warned = verdicts.filter(({ verdict }) => verdict.level === "warn");

console.log(
	`Judged ${verdicts.length} changed block(s): ${failed.length} against the charter, ${warned.length} borderline.`,
);

if (failed.length > 0 && !allow) process.exit(1);
