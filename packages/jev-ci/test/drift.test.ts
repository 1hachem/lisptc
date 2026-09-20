import type { Ask, JevHost } from "@repo/jev/jev";
import type { SystemOneRequest } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import type { Block } from "../src/blocks.ts";
import type { Answers } from "../src/charter.ts";
import {
	CONTRADICTED,
	DRIFT_KINDS,
	type DriftKind,
	driftJudge,
	driftQuestions,
	driftRouter,
	MENTION_KINDS,
	type Mention,
	type MentionKind,
	ROUTE_ODDS,
	readDrift,
	readRoutes,
	routeQuestions,
	SUFFICIENT,
} from "../src/drift.ts";

const BLOCK: Block = {
	id: "b0",
	heading: "AGENTS.md > Packages",
	text: "`packages/checks` holds the DSL.",
	line: 4,
};

function judged(
	contradicted: number,
	sufficient: number,
	drift: DriftKind = "renamed",
	weight = 3,
): Answers {
	return {
		contradicted: { type: "noul", noul: contradicted },
		sufficient: { type: "noul", noul: sufficient },
		drift: { type: "choice", choice: drift, confidence: 1, probabilities: {} },
		weight: {
			type: "score",
			score: weight,
			confidence: 1,
			legend: {},
			probabilities: {},
		},
	} as unknown as Answers;
}

function routed(probabilities: Partial<Record<MentionKind, number>>): Answers {
	const top = Object.entries(probabilities).sort(([, a], [, b]) => b - a)[0];
	return {
		route_m0: {
			type: "choice",
			choice: top?.[0] ?? "none",
			confidence: 1,
			probabilities,
		},
	} as unknown as Answers;
}

function jev(answers: Answers): {
	host: JevHost;
	asked: () => SystemOneRequest | undefined;
} {
	let asked: SystemOneRequest | undefined;
	const ask = ((request: SystemOneRequest) => {
		asked = request;
		return Promise.resolve({
			model: "typesafe/jev-1.13",
			usage: { input_tokens: 1, output_tokens: 1 },
			answers,
		});
	}) as Ask;
	return { host: { ask }, asked: () => asked };
}

describe("routeQuestions", () => {
	it("offers a reading for a token the surrounding sentence forbids", () => {
		const questions = routeQuestions([{ block: "b0", token: "devdocs/" }]);

		expect(questions.route_m0.criteria).toBe(MENTION_KINDS);
		expect(MENTION_KINDS.prohibition).toContain("must NOT exist");
	});

	it("points each question at its own mention", () => {
		const questions = routeQuestions([
			{ block: "b0", token: "a" },
			{ block: "b3", token: "b" },
		]);

		expect(JSON.stringify(questions.route_m1.instructions)).toContain(
			"`mentions.m1.token`",
		);
		expect(JSON.stringify(questions.route_m1.instructions)).toContain(
			"`blocks.b3.text`",
		);
	});
});

describe("driftQuestions", () => {
	it("gates the verdict on two questions and labels it with two more", () => {
		const questions = driftQuestions();

		expect(Object.keys(questions)).toEqual([
			"contradicted",
			"sufficient",
			"drift",
			"weight",
		]);
		expect(questions.contradicted.type).toBe("noul");
		expect(questions.sufficient.type).toBe("noul");
		expect(questions.drift.criteria).toBe(DRIFT_KINDS);
	});
});

describe("readRoutes", () => {
	const mention: Mention = { block: "b0", token: "devdocs/" };

	it("keeps every reading the model left on the table", () => {
		const [kinds] = readRoutes(
			[mention],
			routed({ prohibition: 0.6, path: 0.3, glob: 0.1 }),
		);

		expect(kinds).toEqual(["prohibition", "path"]);
	});

	it("resolves at the threshold and not below it", () => {
		const [kinds] = readRoutes(
			[mention],
			routed({ path: 0.8, glob: ROUTE_ODDS, symbol: ROUTE_ODDS - 0.01 }),
		);

		expect(kinds).toEqual(["path", "glob"]);
	});

	it("falls back to the single pick when nothing clears the threshold", () => {
		const spread: Partial<Record<MentionKind, number>> = {
			path: 0.14,
			glob: 0.14,
			symbol: 0.14,
			command: 0.14,
			package: 0.14,
			convention: 0.14,
			prohibition: 0.14,
			none: 0.02,
		};

		const [kinds] = readRoutes([mention], routed(spread));

		expect(kinds).toEqual(["path"]);
	});

	it("reads an unanswered mention as pointing at nothing", () => {
		expect(readRoutes([mention], {} as Answers)).toEqual([["none"]]);
	});
});

describe("readDrift", () => {
	it.each([
		["contradicted on evidence that settles it", 0.9, 0.9, "drift"],
		["contradicted on evidence that does not", 0.9, 0.3, "unchecked"],
		["consistent with evidence that settles it", 0.1, 0.9, "holds"],
		["consistent with nothing to settle it", 0.1, 0.2, "unanchored"],
		["exactly at both thresholds", CONTRADICTED, SUFFICIENT, "drift"],
		["just under contradicted", CONTRADICTED - 0.01, 0.9, "holds"],
		["just under sufficient", 0.9, SUFFICIENT - 0.01, "unchecked"],
	])("reads %s as %s", (_name, contradicted, sufficient, level) => {
		const verdict = readDrift(BLOCK, judged(contradicted, sufficient));

		expect(verdict?.level).toBe(level);
	});

	it("carries the drift kind and the harm through", () => {
		const verdict = readDrift(BLOCK, judged(0.9, 0.9, "deleted", 2.4));

		expect(verdict?.drift).toBe("deleted");
		expect(verdict?.weight).toBeCloseTo(2.4);
	});

	it("gives no verdict when the model answered neither gate", () => {
		expect(readDrift(BLOCK, {} as Answers)).toBeUndefined();
	});
});

describe("driftRouter", () => {
	it("asks about every mention in one request", async () => {
		const fake = jev(routed({ path: 1 }));
		const mentions: Mention[] = [
			{ block: "b0", token: "packages/checks" },
			{ block: "b0", token: "@repo/checks" },
		];

		await driftRouter(fake.host)("AGENTS.md", [BLOCK], mentions);

		expect(Object.keys(fake.asked()?.questions ?? {})).toEqual([
			"route_m0",
			"route_m1",
		]);
	});

	it("asks nothing when no block mentions anything", async () => {
		const fake = jev({} as Answers);

		expect(await driftRouter(fake.host)("AGENTS.md", [BLOCK], [])).toEqual([]);
		expect(fake.asked()).toBeUndefined();
	});
});

describe("driftJudge", () => {
	it("hands the model what the repository said about each mention", async () => {
		const fake = jev(judged(0.9, 0.9));

		await driftJudge(fake.host)("AGENTS.md", BLOCK, [
			{ token: "devdocs/", kind: "prohibition", found: "nothing matches" },
		]);

		const state = fake.asked()?.state as { evidence: unknown[] };

		expect(state.evidence).toEqual([
			{
				mention: "devdocs/",
				reads_as: "prohibition",
				repository_says: "nothing matches",
			},
		]);
	});
});
