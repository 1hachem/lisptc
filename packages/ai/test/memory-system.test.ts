import type { JudgeRequest, SystemOneModel } from "@repo/shared/system-one";
import { describe, expect, it } from "vitest";
import { memorySystem, RECOGNITION_TIMEOUT_MS } from "../src/memory-system.ts";

function systemOne(noul: (instructions: unknown) => number): {
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

const BROWSER = {
	key: "browser/local",
	situation: "the agent is about to drive a web page",
	unless: "the agent only reads a page's text",
	gist: "start a local Chrome first",
};

const BILLING = {
	key: "billing/plans",
	situation: "the user asks about billing",
	gist: "plans are monthly",
};

const CONVERSATION = [
	{ role: "user", content: "hi" },
	{ role: "assistant", content: "hello" },
	{ role: "user", content: "get me the price" },
	{ role: "assistant", content: "(search q)" },
	{ role: "tool", content: "one hit" },
	{ role: "assistant", content: "(fetch url)" },
	{ role: "tool", content: "needs javascript" },
];

describe("recognizing which memories the conversation calls for", () => {
	it("asks every memory in one request, one noul each, scored by key", async () => {
		const { seen, model } = systemOne((i) =>
			JSON.stringify(i).includes("browser") ? 0.9 : 0.1,
		);
		const recognized = await memorySystem(model)(
			{ conversation: CONVERSATION },
			[BROWSER, BILLING],
		);
		expect(recognized).toEqual(
			new Map([
				["browser/local", 0.9],
				["billing/plans", 0.1],
			]),
		);
		expect(seen).toHaveLength(1);
		expect(Object.values(seen[0]?.questions ?? {}).map((q) => q.type)).toEqual([
			"noul",
			"noul",
		]);
	});

	it("hands over the current message and the last step as latest, the rest as earlier", async () => {
		const { seen, model } = systemOne(() => 0.5);
		await memorySystem(model)({ conversation: CONVERSATION }, [BROWSER]);
		expect(seen[0]?.state).toMatchObject({
			latest: {
				message: "get me the price",
				code: "(fetch url)",
				result: "needs javascript",
			},
			earlier: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "hello" },
				{ role: "assistant", content: "(search q)" },
				{ role: "tool", content: "one hit" },
			],
		});
	});

	it("hands over a fresh message alone as latest, before any step", async () => {
		const { seen, model } = systemOne(() => 0.5);
		await memorySystem(model)({ conversation: CONVERSATION.slice(0, 3) }, [
			BROWSER,
		]);
		expect(seen[0]?.state).toMatchObject({
			latest: { message: "get me the price" },
			earlier: CONVERSATION.slice(0, 2),
		});
	});

	it("tells each question its memory's situation, exclusion, key and gist", async () => {
		const { seen, model } = systemOne(() => 0.5);
		await memorySystem(model)({ conversation: CONVERSATION }, [
			BROWSER,
			BILLING,
		]);
		const [browser, billing] = Object.values(seen[0]?.questions ?? {});
		expect(browser?.instructions).toMatchObject({
			situation: BROWSER.situation,
			unless: BROWSER.unless,
			memory: { key: BROWSER.key, teaches: BROWSER.gist },
		});
		expect(billing?.instructions).not.toHaveProperty("unless");
	});

	it("fails when the model leaves a memory unanswered", async () => {
		const model: SystemOneModel = {
			provider: "fake",
			model: "fake/jev",
			judge: async () => ({ model: "fake/jev", answers: {} }),
		};
		await expect(
			memorySystem(model)({ conversation: [{ role: "user", content: "hi" }] }, [
				BILLING,
			]),
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
			memorySystem(model, 10)(
				{ conversation: [{ role: "user", content: "hi" }] },
				[BILLING],
			),
		).rejects.toThrow();
	});

	it("waits at most two seconds for a judgment before a step goes ahead without it", () => {
		expect(RECOGNITION_TIMEOUT_MS).toBe(2_000);
	});
});
