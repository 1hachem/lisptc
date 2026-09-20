import type { JevHost } from "@repo/jev/jev";
import { jevHost } from "@repo/jev/jev-host";
import {
	type ChoiceQuestion,
	choice,
	type NoulQuestion,
	noul,
	type Questions,
	type ScoreQuestion,
	score,
} from "@typesafe-ai/sdk";
import type { Block } from "./blocks.ts";
import type { Answers } from "./charter.ts";

export const MENTION_KINDS = {
	path: "One literal file or directory in this repository, named so the reader can go and open it.",
	glob: "A pattern standing for many paths at once, with a wildcard the reader is expected to expand.",
	convention:
		"A naming shape rather than a name: a suffix, an extension, or a placeholder such as a bracketed word, describing what files of a kind are called.",
	package:
		"A workspace package by its published name, where the claim is about that package as a whole.",
	symbol:
		"An identifier in the source: a type, a function, a field, an exported name, a configuration key.",
	command:
		"Something a person runs: a package script, a task, a shell invocation.",
	prohibition:
		"A thing the surrounding sentence says must NOT exist, or must not be added. The claim holds precisely when nothing in the repository matches it.",
	none: "Not a reference to anything in this repository: a quoted phrase, an external product, a piece of prose set in code font.",
} as const;

export type MentionKind = keyof typeof MENTION_KINDS;

export const ROUTE_ODDS = 0.15;

export interface Mention {
	block: string;
	token: string;
}

export interface Evidence {
	token: string;
	kind: MentionKind;
	found: string;
}

export const DRIFT_KINDS = {
	renamed: "The thing still exists under a different name.",
	moved: "The thing still exists under the same name somewhere else.",
	deleted:
		"The thing existed once and is gone, with nothing standing in for it.",
	absent:
		"The evidence shows no sign the thing was ever there under any name close to this one.",
	narrowed:
		"It still exists, but the claim is now wider than the truth: the rule covers less, or fewer things obey it, than the block says.",
	widened:
		"It still exists, but the claim is now narrower than the truth: more things exist, or more cases apply, than the block accounts for.",
	emphasis:
		"Everything the block names is still there and the claim still holds; only the framing has aged.",
} as const;

export type DriftKind = keyof typeof DRIFT_KINDS;

const WEIGHT = [
	"Nothing. An agent that trusts this block does the right thing anyway.",
	"It wastes a search. The agent looks in the named place, finds nothing, and looks again.",
	"It sends work to the wrong place. The agent writes a file, an import or a dependency where the repository does not want it.",
	"It breaks a rule the repository enforces. The agent follows this block and a test, a lint rule or a boundary check fails.",
] as const;

export const CONTRADICTED = 0.7;
export const SUFFICIENT = 0.7;

type DriftLevel = "drift" | "unchecked" | "holds" | "unanchored";

export interface DriftVerdict {
	block: Block;
	level: DriftLevel;
	drift: DriftKind;
	weight: number;
	contradicted: number;
	sufficient: number;
}

function route(
	mention: Mention,
	at: number,
): ChoiceQuestion<typeof MENTION_KINDS> {
	return choice(
		{
			sentence: `\`blocks.${mention.block}.text\``,
			mention: `\`mentions.m${at}.token\``,
			question:
				"In the sentence it appears in, what is this mention pointing at?",
		},
		MENTION_KINDS,
	);
}

export function routeQuestions(mentions: readonly Mention[]): Questions {
	const questions: Questions = {};
	for (const [at, mention] of mentions.entries())
		questions[`route_m${at}`] = route(mention, at);
	return questions;
}

export function readRoutes(
	mentions: readonly Mention[],
	answers: Answers,
): MentionKind[][] {
	return mentions.map((_, at) => {
		const answer = answers[`route_m${at}`];
		if (answer?.type !== "choice") return ["none"];
		const kinds = Object.entries(answer.probabilities)
			.filter(([, odds]) => odds >= ROUTE_ODDS)
			.map(([kind]) => kind as MentionKind);
		return kinds.length === 0 ? [answer.choice as MentionKind] : kinds;
	});
}

function contradicted(): NoulQuestion {
	return noul(
		{
			block: "`block`",
			heading: "`heading`",
			evidence: "`evidence`",
			question:
				"Does the evidence gathered from the repository contradict what this block says?",
		},
		{
			true: "Yes: the repository, as the evidence shows it, disagrees with the block. Something it names is gone, renamed, or behaves other than it says.",
			false:
				"No: everything the block says is consistent with the evidence, or the block says nothing the evidence can disagree with.",
		},
	);
}

function sufficient(): NoulQuestion {
	return noul(
		{
			block: "`block`",
			evidence: "`evidence`",
			question:
				"Is this evidence enough to settle whether the block is true, either way?",
		},
		{
			true: "Yes: the evidence covers what the block talks about, so a verdict either way rests on something.",
			false:
				"No: the thing the block talks about is not in this evidence at all. Any verdict would be a guess.",
		},
	);
}

function drifted(): ChoiceQuestion<typeof DRIFT_KINDS> {
	return choice(
		{
			premise:
				"Suppose the evidence in `evidence` does contradict the block in `block`.",
			question: "What kind of change happened underneath it?",
		},
		DRIFT_KINDS,
	);
}

function weighed(): ScoreQuestion<typeof WEIGHT> {
	return score(
		{
			premise:
				"Suppose the block in `block` is now wrong, and a coding agent reads it and believes it.",
			question: "What goes wrong?",
		},
		WEIGHT,
	);
}

export function driftQuestions(): Questions {
	return {
		contradicted: contradicted(),
		sufficient: sufficient(),
		drift: drifted(),
		weight: weighed(),
	};
}

function level(against: number, enough: number): DriftLevel {
	if (against >= CONTRADICTED)
		return enough >= SUFFICIENT ? "drift" : "unchecked";
	return enough >= SUFFICIENT ? "holds" : "unanchored";
}

export function readDrift(
	block: Block,
	answers: Answers,
): DriftVerdict | undefined {
	const against = answers.contradicted;
	const enough = answers.sufficient;
	const kind = answers.drift;
	const weight = answers.weight;
	if (against?.type !== "noul" || enough?.type !== "noul") return undefined;
	return {
		block,
		level: level(against.noul, enough.noul),
		drift: kind?.type === "choice" ? (kind.choice as DriftKind) : "emphasis",
		weight: weight?.type === "score" ? weight.score : 0,
		contradicted: against.noul,
		sufficient: enough.noul,
	};
}

export function driftRouter(
	host: JevHost = jevHost,
): (
	file: string,
	blocks: readonly Block[],
	mentions: readonly Mention[],
) => Promise<MentionKind[][]> {
	return async (file, blocks, mentions) => {
		if (mentions.length === 0) return [];
		const { answers } = await host.ask({
			state: {
				file,
				blocks: Object.fromEntries(
					blocks.map((block) => [block.id, { text: block.text }]),
				),
				mentions: Object.fromEntries(
					mentions.map((mention, at) => [`m${at}`, { token: mention.token }]),
				),
			},
			questions: routeQuestions(mentions),
		});
		return readRoutes(mentions, answers);
	};
}

export function driftJudge(
	host: JevHost = jevHost,
): (
	file: string,
	block: Block,
	evidence: readonly Evidence[],
) => Promise<DriftVerdict | undefined> {
	return async (file, block, evidence) => {
		const { answers } = await host.ask({
			state: {
				file,
				heading: block.heading,
				block: block.text,
				evidence: evidence.map((one) => ({
					mention: one.token,
					reads_as: one.kind,
					repository_says: one.found,
				})),
			},
			questions: driftQuestions(),
		});
		return readDrift(block, answers);
	};
}
