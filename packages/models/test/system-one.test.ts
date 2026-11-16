import { describe, expect, it } from "vitest";
import { JEV_MODEL, openRouterSystemOne } from "../src/system-one.ts";

interface Sent {
	url: string;
	headers: Headers;
	body: Record<string, unknown>;
}

function stubFetch(reply: unknown) {
	const sent: Sent[] = [];
	const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
		sent.push({
			url,
			headers: new Headers(init?.headers),
			body: JSON.parse(String(init?.body)),
		});
		return new Response(JSON.stringify(reply), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};
	return { sent, fetch };
}

const REPLY = {
	model: "typesafe/jev-1.14-20261020",
	answers: {
		refund: { type: "noul", noul: 0.97 },
		team: {
			type: "choice",
			choice: "billing",
			confidence: 0.9,
			probabilities: { billing: 0.95, technical: 0.05 },
		},
		urgency: {
			type: "score",
			score: 1.4,
			confidence: 0.6,
			legend: { "0": "can wait", "1": "today", "2": "now" },
			probabilities: { "0": 0.1, "1": 0.4, "2": 0.5 },
		},
	},
	usage: { input_tokens: 40, output_tokens: 3 },
	id: "gen-1",
	provider: "TypeSafe",
};

describe("openRouterSystemOne", () => {
	it("sends the judgment to OpenRouter's System One endpoint with the key", async () => {
		const { sent, fetch } = stubFetch(REPLY);
		const model = openRouterSystemOne({
			apiKey: "or-test",
			apiKeyEnv: "OPENROUTER_API_KEY",
			baseUrl: "https://openrouter.ai/api/v1",
			fetch,
		});
		await model.judge({
			state: "I was charged twice.",
			questions: {
				refund: { type: "noul", instructions: "Is it a refund request?" },
			},
		});
		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toBe("https://openrouter.ai/api/v1/systemone");
		expect(sent[0]?.headers.get("authorization")).toBe("Bearer or-test");
		expect(sent[0]?.body).toMatchObject({
			model: JEV_MODEL,
			state: "I was charged twice.",
			questions: {
				refund: { type: "noul", instructions: "Is it a refund request?" },
			},
		});
	});

	it("asks for the model a request names over its own", async () => {
		const { sent, fetch } = stubFetch(REPLY);
		const model = openRouterSystemOne({
			apiKey: "or-test",
			apiKeyEnv: "OPENROUTER_API_KEY",
			baseUrl: "https://openrouter.ai/api/v1",
			fetch,
		});
		await model.judge({
			state: "x",
			questions: { refund: { type: "noul", instructions: "?" } },
			model: "jev-latest",
		});
		expect(sent[0]?.body.model).toBe("jev-latest");
	});

	it("returns each answer as a verdict, with the model that gave it", async () => {
		const { fetch } = stubFetch(REPLY);
		const model = openRouterSystemOne({
			apiKey: "or-test",
			apiKeyEnv: "OPENROUTER_API_KEY",
			baseUrl: "https://openrouter.ai/api/v1",
			fetch,
		});
		const res = await model.judge({
			state: "I was charged twice.",
			questions: {
				refund: { type: "noul", instructions: "Is it a refund request?" },
				team: {
					type: "choice",
					instructions: "Which team?",
					criteria: { billing: null, technical: null },
				},
				urgency: {
					type: "score",
					instructions: "How urgent?",
					criteria: ["can wait", "today", "now"],
				},
			},
		});
		expect(res).toEqual({
			model: "typesafe/jev-1.14-20261020",
			answers: {
				refund: { type: "noul", noul: 0.97 },
				team: {
					type: "choice",
					choice: "billing",
					confidence: 0.9,
					probabilities: { billing: 0.95, technical: 0.05 },
				},
				urgency: { type: "score", score: 1.4, confidence: 0.6 },
			},
		});
	});

	it("names the missing variable instead of calling OpenRouter without a key", async () => {
		const { sent, fetch } = stubFetch(REPLY);
		const model = openRouterSystemOne({
			apiKey: undefined,
			apiKeyEnv: "OPENROUTER_API_KEY",
			baseUrl: "https://openrouter.ai/api/v1",
			fetch,
		});
		await expect(
			model.judge({
				state: "x",
				questions: { q: { type: "noul", instructions: "?" } },
			}),
		).rejects.toThrow("OPENROUTER_API_KEY is not set");
		expect(sent).toHaveLength(0);
	});
});
