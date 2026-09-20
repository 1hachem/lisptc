import type { Questions, SystemOneRequest } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import type { Block } from "../src/blocks.ts";
import {
	type Answers,
	CHARTER,
	charterQuestions,
	charterReview,
	DESCRIBES,
	KINDS,
	ROTS,
	readCharter,
	SURE,
} from "../src/charter.ts";
import type { Ask, JevHost } from "../src/jev.ts";

function block(text: string, id = "b0"): Block {
	return { id, heading: "AGENTS.md > Testing", text, line: 1 };
}

function answered(
	blocks: readonly Block[],
	each: (block: Block) => {
		rots: number;
		altitude: number;
		confidence?: number;
		kind?: string;
	},
): Answers {
	const answers: Record<string, unknown> = {};
	for (const one of blocks) {
		const { rots, altitude, confidence = 1, kind = "rule" } = each(one);
		answers[`rots_${one.id}`] = { type: "noul", noul: rots };
		answers[`altitude_${one.id}`] = {
			type: "score",
			score: altitude,
			confidence,
			legend: {},
			probabilities: {},
		};
		answers[`kind_${one.id}`] = {
			type: "choice",
			choice: kind,
			confidence: 1,
			probabilities: {},
		};
	}
	return answers as Answers;
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

describe("charterQuestions", () => {
	it("asks three questions per block and reaches state by path", () => {
		const questions: Questions = charterQuestions([block("text")]);

		expect(Object.keys(questions)).toEqual([
			"rots_b0",
			"altitude_b0",
			"kind_b0",
		]);
		expect(JSON.stringify(questions.rots_b0.instructions)).toContain(
			"`blocks.b0.text`",
		);
	});

	it("offers the kinds the annotation is allowed to name", () => {
		const questions = charterQuestions([block("text")]);

		expect(questions.kind_b0.criteria).toBe(KINDS);
		expect(Object.keys(KINDS)).toEqual([
			"pointer",
			"rule",
			"mechanism",
			"inventory",
			"rationale",
			"audience",
		]);
	});

	it("carries the charter itself as state, not as a question", () => {
		const one = block("text");
		const fake = jev(answered([one], () => ({ rots: 0.1, altitude: 0 })));

		return charterReview(fake.host)("AGENTS.md", [one]).then(() => {
			const state = fake.asked()?.state as { charter: string };

			expect(state.charter).toBe(CHARTER);
			expect(CHARTER).toContain("prose rots and the code does not");
		});
	});

	it("sends the block text once however many questions read it", () => {
		const one = block("the interpreter depends on nothing above it");
		const fake = jev(answered([one], () => ({ rots: 0.1, altitude: 0 })));

		return charterReview(fake.host)("AGENTS.md", [one]).then(() => {
			const sent = JSON.stringify(fake.asked()?.state);

			expect(sent.split("depends on nothing above it")).toHaveLength(2);
		});
	});
});

describe("readCharter", () => {
	it.each([
		["a pointer nothing can falsify silently", 0.1, 0.4, "pass"],
		["a rule that survives a rewrite", 0.2, 1.1, "pass"],
		["prose that rots but only points", 0.9, 1.0, "warn"],
		["a mechanism a test still guards", 0.3, 2.6, "warn"],
		["a mechanism nothing guards", 0.88, 2.4, "fail"],
		["exactly at both thresholds", ROTS, DESCRIBES, "fail"],
		["just under the rot threshold", 0.74, 2.9, "warn"],
		["just under the altitude threshold", 0.99, 1.99, "warn"],
	])("reads %s as %s", (_name, rots, altitude, level) => {
		const one = block("text");

		const [verdict] = readCharter(
			[one],
			answered([one], () => ({ rots, altitude })),
		);

		expect(verdict.level).toBe(level);
	});

	it("downgrades a failure the model is unsure of", () => {
		const one = block("text");
		const spread = { rots: 0.9, altitude: 2.5, confidence: SURE - 0.01 };

		const [verdict] = readCharter(
			[one],
			answered([one], () => spread),
		);

		expect(verdict.level).toBe("warn");
	});

	it("keeps a failure the model is sure of", () => {
		const one = block("text");
		const peaked = { rots: 0.9, altitude: 2.5, confidence: SURE };

		const [verdict] = readCharter(
			[one],
			answered([one], () => peaked),
		);

		expect(verdict.level).toBe("fail");
	});

	it("skips a block the model did not answer for", () => {
		expect(readCharter([block("text")], {} as Answers)).toEqual([]);
	});

	it("names the kind so the annotation can say what it is", () => {
		const one = block("text");
		const detail = { rots: 0.9, altitude: 3, kind: "inventory" };

		const [verdict] = readCharter(
			[one],
			answered([one], () => detail),
		);

		expect(verdict.kind).toBe("inventory");
	});
});

describe("charterReview", () => {
	it("asks nothing when the change added no prose", async () => {
		const fake = jev({} as Answers);

		expect(await charterReview(fake.host)("AGENTS.md", [])).toEqual([]);
		expect(fake.asked()).toBeUndefined();
	});

	it("judges every changed block in one request", async () => {
		const blocks = [block("one", "b0"), block("two", "b1")];
		const fake = jev(answered(blocks, () => ({ rots: 0.9, altitude: 3 })));

		const verdicts = await charterReview(fake.host)("AGENTS.md", blocks);

		expect(verdicts.map((one) => one.level)).toEqual(["fail", "fail"]);
		expect(Object.keys(fake.asked()?.questions ?? {})).toHaveLength(6);
	});
});
