import type {
	JudgeRequest,
	Judgment,
	SystemOneModel,
	Verdict,
} from "@repo/shared/system-one";
import { describe, expect, it } from "vitest";
import {
	type Area,
	memorySystem,
	RECOGNITION_TIMEOUT_MS,
} from "../src/memory-system.ts";

type Answer = (question: Judgment, request: JudgeRequest) => Verdict;

function systemOne(answer: Answer): {
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
							answer(q, req),
						]),
					),
				};
			},
		},
	};
}

function choosing(probabilities: Record<string, number>, gate = 0.9): Answer {
	return (question) => {
		if (question.type === "noul") return { type: "noul", noul: gate };
		const options = Object.keys(question.criteria);
		const spread = Object.fromEntries(
			options.map((option) => [option, probabilities[option] ?? 0]),
		);
		return {
			type: "choice",
			choice: options[0] as string,
			confidence: 1,
			probabilities: spread,
		};
	};
}

const LOCAL = {
	key: "browser/local",
	situation: "the agent is about to drive a web page",
	unless: "the agent only reads a page's text",
	gist: "start a local Chrome first",
	area: "browser",
};

const FLAGS = {
	key: "browser/flags",
	situation: "the agent passes flags to the browser",
	gist: "pass :quiet t only when listed",
	area: "browser",
};

const BILLING = {
	key: "billing",
	situation: "the user asks about billing",
	gist: "plans are monthly",
};

const BROWSER: Area = {
	name: "browser",
	situation: "the work drives a web browser",
	open: false,
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

function choices(req: JudgeRequest | undefined): Record<string, unknown> {
	const pick = Object.values(req?.questions ?? {}).find(
		(q) => q.type === "choice",
	);
	return pick?.type === "choice" ? pick.criteria : {};
}

describe("recognizing which memories the conversation calls for", () => {
	it("sends one request per area, and one for memories filed under none", async () => {
		const { seen, model } = systemOne(choosing({}));
		await memorySystem(model)(
			{ conversation: CONVERSATION },
			[LOCAL, FLAGS, BILLING],
			[BROWSER],
		);
		expect(seen.map((req) => Object.keys(choices(req)).sort())).toEqual(
			expect.arrayContaining([
				["browser/flags", "browser/local", "none"],
				["billing", "none"],
			]),
		);
		expect(seen).toHaveLength(2);
	});

	it("starts every request before any of them answers", async () => {
		let started = 0;
		let release: () => void = () => {};
		const all = new Promise<void>((resolve) => {
			release = resolve;
		});
		const model: SystemOneModel = {
			provider: "fake",
			model: "fake/jev",
			async judge(req) {
				started += 1;
				if (started === 2) release();
				await all;
				return {
					model: "fake/jev",
					answers: Object.fromEntries(
						Object.entries(req.questions).map(([id, q]) => [
							id,
							choosing({ none: 1 })(q, req),
						]),
					),
				};
			},
		};
		await memorySystem(model)(
			{ conversation: CONVERSATION },
			[LOCAL, BILLING],
			[BROWSER],
		);
		expect(started).toBe(2);
	});

	it("always offers none, and fires nothing when none wins", async () => {
		const { model } = systemOne(choosing({ none: 0.9, "browser/local": 0.1 }));
		const recognized = await memorySystem(model)(
			{ conversation: CONVERSATION },
			[LOCAL, FLAGS],
			[BROWSER],
		);
		expect(Math.max(...recognized.values())).toBeLessThan(0.7);
	});

	it("fires every memory as likely as the best one, so two needed at once both fire", async () => {
		const { model } = systemOne(
			choosing({ "browser/local": 0.45, "browser/flags": 0.45, none: 0.1 }),
		);
		const recognized = await memorySystem(model)(
			{ conversation: CONVERSATION },
			[LOCAL, FLAGS],
			[BROWSER],
		);
		expect(recognized.get("browser/local")).toBe(1);
		expect(recognized.get("browser/flags")).toBe(1);
	});

	it("weighs an area's memories only when its gate opens", async () => {
		const { model } = systemOne(choosing({ "browser/local": 1 }, 0.1));
		const recognized = await memorySystem(model)(
			{ conversation: CONVERSATION },
			[LOCAL],
			[BROWSER],
		);
		expect(recognized.get("browser/local")).toBe(0);
	});

	it("asks no gate for an area the last step already called into", async () => {
		const { seen, model } = systemOne(choosing({ "browser/local": 1 }, 0));
		const recognized = await memorySystem(model)(
			{ conversation: CONVERSATION },
			[LOCAL],
			[{ ...BROWSER, open: true }],
		);
		expect(recognized.get("browser/local")).toBe(1);
		expect(Object.values(seen[0]?.questions ?? {}).map((q) => q.type)).toEqual([
			"choice",
		]);
	});

	it("tells each option its memory's situation, exclusion and gist", async () => {
		const { seen, model } = systemOne(choosing({}));
		await memorySystem(model)(
			{ conversation: CONVERSATION },
			[LOCAL],
			[BROWSER],
		);
		const option = String(choices(seen[0])["browser/local"]);
		expect(option).toContain(LOCAL.situation);
		expect(option).toContain(LOCAL.unless);
		expect(option).toContain(LOCAL.gist);
	});

	it("hands over the current message and the last step as latest, the rest as earlier", async () => {
		const { seen, model } = systemOne(choosing({}));
		await memorySystem(model)({ conversation: CONVERSATION }, [BILLING]);
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
		const { seen, model } = systemOne(choosing({}));
		await memorySystem(model)({ conversation: CONVERSATION.slice(0, 3) }, [
			BILLING,
		]);
		expect(seen[0]?.state).toMatchObject({
			latest: { message: "get me the price" },
			earlier: CONVERSATION.slice(0, 2),
		});
	});

	it("fires what the answered areas pick when another area fails", async () => {
		const { model } = systemOne(choosing({ [LOCAL.key]: 1 }));
		const flaky: SystemOneModel = {
			...model,
			judge: (req, signal) =>
				BILLING.key in choices(req)
					? Promise.reject(new Error("area down"))
					: model.judge(req, signal),
		};
		const scores = await memorySystem(flaky)(
			{ conversation: CONVERSATION },
			[LOCAL, BILLING],
			[{ ...BROWSER, open: true }],
		);
		expect(scores.get(LOCAL.key)).toBe(1);
		expect(scores.has(BILLING.key)).toBe(false);
	});

	it("fails when the model leaves every area unanswered", async () => {
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
