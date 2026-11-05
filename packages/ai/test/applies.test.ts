import type { JudgeRequest, SystemOneModel } from "@repo/shared/system-one";
import { describe, expect, it } from "vitest";
import { APPLIES_TIMEOUT_MS, appliesJudge } from "../src/applies.ts";

function judging(noul: (instructions: string) => number): {
	seen: JudgeRequest[];
	model: SystemOneModel;
} {
	const seen: JudgeRequest[] = [];
	return {
		seen,
		model: {
			provider: "fake",
			model: "fake/jev",
			async judge(req) {
				seen.push(req);
				return {
					model: "fake/jev",
					answers: Object.fromEntries(
						Object.entries(req.questions).map(([id, q]) => [
							id,
							{ type: "noul", noul: noul(q.instructions) },
						]),
					),
				};
			},
		},
	};
}

describe("judging which descriptions a message calls for", () => {
	it("asks one noul per description, with the message as the state", async () => {
		const { seen, model } = judging((i) => (i.includes("browser") ? 0.9 : 0.1));
		const judged = await appliesJudge(model)({ message: "open my browser" }, [
			"user wants to automate a browser",
			"user asks about billing",
		]);
		expect(judged).toEqual(
			new Map([
				["user wants to automate a browser", 0.9],
				["user asks about billing", 0.1],
			]),
		);
		expect(seen[0]?.state).toEqual({ message: "open my browser" });
		expect(Object.values(seen[0]?.questions ?? {}).map((q) => q.type)).toEqual([
			"noul",
			"noul",
		]);
	});

	it("hands the latest step to System One beside the message", async () => {
		const { seen, model } = judging(() => 0.5);
		await appliesJudge(model)(
			{ message: "get me the price", step: "(fetch url)\n\nneeds javascript" },
			["user wants to automate a browser"],
		);
		expect(seen[0]?.state).toEqual({
			message: "get me the price",
			step: "(fetch url)\n\nneeds javascript",
		});
	});

	it("fails when the model leaves a description unanswered", async () => {
		const model: SystemOneModel = {
			provider: "fake",
			model: "fake/jev",
			judge: async () => ({ model: "fake/jev", answers: {} }),
		};
		await expect(
			appliesJudge(model)({ message: "hi" }, ["x"]),
		).rejects.toThrow();
	});

	it("gives up after its timeout, so the turn is never held by it", async () => {
		const model: SystemOneModel = {
			provider: "fake",
			model: "fake/jev",
			judge: (_, signal) =>
				new Promise((_, reject) =>
					signal?.addEventListener("abort", () => reject(signal.reason)),
				),
		};
		await expect(
			appliesJudge(model, 10)({ message: "hi" }, ["x"]),
		).rejects.toThrow();
	});

	it("waits at most two seconds for a judgment before a step goes ahead without it", () => {
		expect(APPLIES_TIMEOUT_MS).toBe(2_000);
	});
});
