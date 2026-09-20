import { jevConfigured } from "@repo/env/decisions";
import {
	affects,
	annotate,
	changedFiles,
	charterFiles,
	flag,
	guess,
	has,
	read,
	resolve,
} from "./agents-host.ts";
import { type Block, chunk, mentions } from "./blocks.ts";
import {
	type DriftVerdict,
	driftJudge,
	driftRouter,
	type Mention,
} from "./drift.ts";

const MOST = 25;
const WRONG_PLACE = 2;

const base = flag("base", "origin/main");
const all = has("all");
const allow = has("allow");

interface Anchored {
	block: Block;
	tokens: string[];
	evidence: string[];
}

function anchored(file: string): Anchored[] {
	return chunk(read(file))
		.map((block) => {
			const tokens = mentions(block);
			return {
				block,
				tokens,
				evidence: [...new Set(tokens.flatMap(guess))],
			};
		})
		.filter((one) => one.tokens.length > 0);
}

function selected(
	blocks: Anchored[],
	changed: ReadonlySet<string>,
): Anchored[] {
	if (all) return blocks;
	return blocks.filter((one) => affects(one.evidence, changed));
}

function report(file: string, verdict: DriftVerdict): void {
	const { block, level, drift, weight, contradicted, sufficient } = verdict;
	if (level === "holds") return;
	if (level === "unanchored") {
		annotate(
			"notice",
			file,
			block.line,
			"charter: unanchored",
			"No evidence in the repository can confirm or deny this block. Nothing falsifies it, which is what the charter forbids.",
		);
		return;
	}
	if (level === "unchecked") {
		annotate(
			"notice",
			file,
			block.line,
			"drift: could not check",
			`This block looks contradicted (${contradicted.toFixed(2)}) but the evidence gathered was not enough to decide (${sufficient.toFixed(2)}). Needs a human.`,
		);
		return;
	}
	annotate(
		weight >= WRONG_PLACE ? "error" : "warning",
		file,
		block.line,
		`drift: ${drift}`,
		[
			`The code no longer matches this block: ${drift}.`,
			`An agent that trusts it scores ${weight.toFixed(2)} of 3 for harm.`,
			drift === "deleted" || drift === "absent"
				? "There is nothing left to point at. Delete the sentence."
				: "Fix the sentence, or move the constraint into a check that fails.",
			`Under: ${block.heading}`,
		].join("\n"),
	);
}

const changed = new Set(all ? [] : changedFiles(base));
const work = charterFiles().map((file) => ({
	file,
	blocks: selected(anchored(file), changed),
}));
const total = work.reduce((sum, one) => sum + one.blocks.length, 0);

if (total === 0) {
	console.log("No charter block references anything this change touched.");
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
const verdicts: { file: string; verdict: DriftVerdict }[] = [];

for (const { file, blocks } of work) {
	if (blocks.length === 0) continue;
	const asking = blocks.slice(0, MOST);
	if (blocks.length > MOST)
		console.log(
			`::notice file=${file}::checking the first ${MOST} of ${blocks.length} affected blocks.`,
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
	for (const one of asking) {
		const evidence = one.tokens.flatMap((token) =>
			resolve(token, routes[at++] ?? ["none"]),
		);
		if (evidence.length === 0) continue;
		const verdict = await judge(file, one.block, evidence);
		if (verdict !== undefined) verdicts.push({ file, verdict });
	}
}

for (const { file, verdict } of verdicts) report(file, verdict);

const drifted = verdicts.filter(({ verdict }) => verdict.level === "drift");
const serious = drifted.filter(({ verdict }) => verdict.weight >= WRONG_PLACE);

console.log(
	`Checked ${verdicts.length} block(s) against the code: ${drifted.length} drifted, ${serious.length} of them seriously.`,
);

if (serious.length > 0 && !allow) process.exit(1);
