import { describe, expect, it } from "vitest";
import { openRouterSystemOne } from "../src/system-one/openrouter.ts";

interface Sent {
	url: string;
	init: RequestInit;
}

function answering(
	body: unknown,
	status = 200,
): {
	sent: Sent[];
	fetch: typeof fetch;
} {
	const sent: Sent[] = [];
	return {
		sent,
		fetch: async (url, init) => {
			sent.push({ url: String(url), init: init ?? {} });
			return new Response(JSON.stringify(body), { status });
		},
	};
}

const QUESTIONS = {
	browser: { type: "noul", instructions: "does it call for a browser?" },
	billing: { type: "noul", instructions: "does it call for billing?" },
} as const;

const OPTIONS = {
	apiKey: "k",
	url: "https://router.test/decisions",
	model: "typesafe/jev-1.13",
};

describe("the OpenRouter System One provider", () => {
	it("posts the state and the questions under the model it was given", async () => {
		const { sent, fetch } = answering({
			model: "typesafe/jev-1.13-20260917",
			answers: {
				browser: { type: "noul", noul: 0.97 },
				billing: { type: "noul", noul: 0.02 },
			},
			usage: { input_tokens: 10, output_tokens: 2, cost: 0.00002 },
		});
		const decision = await openRouterSystemOne({ ...OPTIONS, fetch }).decide({
			state: { message: "open my browser" },
			questions: QUESTIONS,
		});
		expect(decision).toEqual({
			answers: { browser: { noul: 0.97 }, billing: { noul: 0.02 } },
			cost: 0.00002,
		});
		expect(sent[0]?.url).toBe(OPTIONS.url);
		expect(new Headers(sent[0]?.init.headers).get("authorization")).toBe(
			"Bearer k",
		);
		expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
			model: "typesafe/jev-1.13",
			state: { message: "open my browser" },
			questions: QUESTIONS,
		});
	});

	it("rejects an answer that leaves a question out", async () => {
		const { fetch } = answering({
			answers: { browser: { type: "noul", noul: 0.5 } },
			usage: { cost: 0 },
		});
		await expect(
			openRouterSystemOne({ ...OPTIONS, fetch }).decide({
				state: {},
				questions: QUESTIONS,
			}),
		).rejects.toThrow(/unanswered: billing/);
	});

	it("rejects a probability outside zero and one", async () => {
		const { fetch } = answering({
			answers: {
				browser: { type: "noul", noul: 2 },
				billing: { type: "noul", noul: 0 },
			},
			usage: { cost: 0 },
		});
		await expect(
			openRouterSystemOne({ ...OPTIONS, fetch }).decide({
				state: {},
				questions: QUESTIONS,
			}),
		).rejects.toThrow();
	});

	it("carries the status and body of a refusal", async () => {
		const { fetch } = answering({ error: "no credits" }, 402);
		await expect(
			openRouterSystemOne({ ...OPTIONS, fetch }).decide({
				state: {},
				questions: QUESTIONS,
			}),
		).rejects.toThrow(/402.*no credits/);
	});

	it("refuses to call without a key", async () => {
		const { sent, fetch } = answering({});
		await expect(
			openRouterSystemOne({ ...OPTIONS, apiKey: "", fetch }).decide({
				state: {},
				questions: QUESTIONS,
			}),
		).rejects.toThrow(/OPENROUTER_API_KEY/);
		expect(sent).toEqual([]);
	});

	it("hands the caller's signal to the request", async () => {
		const { sent, fetch } = answering({
			answers: {
				browser: { type: "noul", noul: 0 },
				billing: { type: "noul", noul: 0 },
			},
			usage: { cost: 0 },
		});
		const signal = AbortSignal.timeout(1000);
		await openRouterSystemOne({ ...OPTIONS, fetch }).decide({
			state: {},
			questions: QUESTIONS,
			signal,
		});
		expect(sent[0]?.init.signal).toBe(signal);
	});
});
