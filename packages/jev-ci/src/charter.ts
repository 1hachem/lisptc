import type { JevHost } from "@repo/jev/jev";
import { jevHost } from "@repo/jev/jev-host";
import {
	type ChoiceQuestion,
	choice,
	type NoulQuestion,
	noul,
	type Questions,
	type ScoreQuestion,
	type SystemOneResult,
	score,
} from "@typesafe-ai/sdk";
import type { Block } from "./blocks.ts";

export const CHARTER =
	"AGENTS.md tells a coding agent how this repository is shaped: which packages exist, which way dependencies run, where a kind of thing belongs, what is forbidden, and which command proves it. It carries no implementation. Names of types, functions, hook points and ports are read in the code, never here, because prose rots and the code does not. A sentence earns its place when it survives a rewrite of the code it talks about, or when a name, a type or a test fails the moment it stops being true.";

export const KINDS = {
	pointer:
		"Says where something lives or what it is called, so a reader can go and read the code itself.",
	rule: "States a constraint the author must follow: which way a dependency runs, where a kind of thing belongs, what is forbidden, which command proves it.",
	mechanism:
		"Explains how something works inside: the steps it takes, the order they run in, what it does with a value it is given.",
	inventory:
		"Lists what the code already holds: names, fields, signatures, options, file contents, directory listings.",
	rationale:
		"Argues for a decision, records a trade-off, or explains why the code ended up the way it did.",
	audience:
		"Written for a reader who is not reading this code at all: what the project is, how to run it, who it is for.",
} as const;

type Kind = keyof typeof KINDS;

const ALTITUDE = [
	"A pointer or a rule. It survives a rewrite of the code it talks about: renaming one function or moving one file does not make it false.",
	"Names a specific file, script, package or directory in order to point at it. False only if that exact thing is renamed, moved or deleted.",
	"Describes how something works, or lists names, fields, signatures or steps that the code already carries. An ordinary refactor makes it wrong.",
	"Explains a mechanism or a design decision in enough depth that the code could change underneath it with nothing failing and nobody noticing.",
] as const;

export const ROTS = 0.75;
export const DESCRIBES = 2;
export const SURE = 0.4;

type CharterLevel = "pass" | "warn" | "fail";

export interface CharterVerdict {
	block: Block;
	level: CharterLevel;
	kind: Kind;
	rots: number;
	altitude: number;
	confidence: number;
}

function rots(id: string): NoulQuestion {
	return noul(
		{
			charter: "`charter`",
			heading: `\`blocks.${id}.heading\``,
			block: `\`blocks.${id}.text\``,
			question:
				"Could a plausible change to this repository's code make this block false, while every type, test, lint rule and name in the repository still passes?",
		},
		{
			true: "Yes: nothing fails when this block stops being true. It rots silently, and a reader trusts it anyway.",
			false:
				"No: either it survives any rewrite because it states a rule or points at where a thing lives, or something in the code fails the moment it stops holding.",
		},
	);
}

function altitude(id: string): ScoreQuestion<typeof ALTITUDE> {
	return score(
		{
			heading: `\`blocks.${id}.heading\``,
			block: `\`blocks.${id}.text\``,
			question:
				"How far does this block go past pointing at the code, into describing it?",
		},
		ALTITUDE,
	);
}

function kind(id: string): ChoiceQuestion<typeof KINDS> {
	return choice(
		{
			heading: `\`blocks.${id}.heading\``,
			block: `\`blocks.${id}.text\``,
			question: "What is this block doing?",
		},
		KINDS,
	);
}

export function charterQuestions(blocks: readonly Block[]): Questions {
	const questions: Questions = {};
	for (const block of blocks) {
		questions[`rots_${block.id}`] = rots(block.id);
		questions[`altitude_${block.id}`] = altitude(block.id);
		questions[`kind_${block.id}`] = kind(block.id);
	}
	return questions;
}

function charterState(
	blocks: readonly Block[],
): Record<string, { heading: string; text: string }> {
	return Object.fromEntries(
		blocks.map((block) => [
			block.id,
			{ heading: block.heading, text: block.text },
		]),
	);
}

function level(
	rotted: number,
	described: number,
	confidence: number,
): CharterLevel {
	if (rotted >= ROTS && described >= DESCRIBES)
		return confidence >= SURE ? "fail" : "warn";
	return rotted >= ROTS || described >= DESCRIBES ? "warn" : "pass";
}

export type Answers = SystemOneResult<Questions>["answers"];

export function readCharter(
	blocks: readonly Block[],
	answers: Answers,
): CharterVerdict[] {
	const verdicts: CharterVerdict[] = [];
	for (const block of blocks) {
		const rotted = answers[`rots_${block.id}`];
		const described = answers[`altitude_${block.id}`];
		const named = answers[`kind_${block.id}`];
		if (rotted?.type !== "noul" || described?.type !== "score") continue;
		verdicts.push({
			block,
			level: level(rotted.noul, described.score, described.confidence),
			kind: named?.type === "choice" ? (named.choice as Kind) : "mechanism",
			rots: rotted.noul,
			altitude: described.score,
			confidence: described.confidence,
		});
	}
	return verdicts;
}

export function charterReview(
	host: JevHost = jevHost,
): (file: string, blocks: readonly Block[]) => Promise<CharterVerdict[]> {
	return async (file, blocks) => {
		if (blocks.length === 0) return [];
		const { answers } = await host.ask({
			state: { charter: CHARTER, file, blocks: charterState(blocks) },
			questions: charterQuestions(blocks),
		});
		return readCharter(blocks, answers);
	};
}
