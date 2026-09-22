import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type Answer,
	ATTEMPTS,
	choice,
	DEFAULT_JUDGE,
	defineJudge,
	isJudgeName,
	JUDGE_NAMES,
	type JudgeSpec,
	judgeReports,
	judgeSpecFor,
	noul,
	type Question,
	score,
} from "../src/judge.ts";

const QUESTIONS: Record<string, Question> = {
	worth_keeping: noul("something here is worth keeping", {
		true: "a correction",
		false: "routine work",
	}),
	kind: choice("what kind of thing is it", {
		fact: "something to know",
		procedure: "something to do",
		nothing: "nothing at all",
	}),
	weight: score("how heavy is it", ["light", "middling", "heavy"]),
};

const ANSWERS: Record<string, Answer> = {
	worth_keeping: { type: "noul", noul: 0.82 },
	kind: {
		type: "choice",
		choice: "procedure",
		confidence: 0.6,
		probabilities: { fact: 0, procedure: 1, nothing: 0 },
	},
	weight: {
		type: "score",
		score: 2,
		confidence: 0.4,
		legend: { "0": "light", "1": "middling", "2": "heavy" },
		probabilities: { "0": 0, "1": 0, "2": 1 },
	},
};

const decisionsSpec: JudgeSpec = {
	label: "Jev",
	apiKey: "sk-test",
	apiKeyEnv: "OPENROUTER_API_KEY",
	baseUrl: "https://judge.test/api",
	defaultModel: "~typesafe/jev-latest",
	protocol: "decisions",
};

const chatSpec: JudgeSpec = {
	label: "OpenRouter",
	apiKey: "sk-chat",
	apiKeyEnv: "OPENROUTER_API_KEY",
	baseUrl: "https://chat.test/api/v1",
	defaultModel: "a/chat-model",
	protocol: "chat",
};

interface Call {
	url: string;
	headers: Record<string, string>;
	body: Record<string, unknown>;
}

function stubFetch(reply: unknown, status = 200): Call[] {
	const calls: Call[] = [];
	vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
		calls.push({
			url,
			headers: init.headers as Record<string, string>,
			body: JSON.parse(String(init.body)),
		});
		return Promise.resolve(
			new Response(typeof reply === "string" ? reply : JSON.stringify(reply), {
				status,
				headers: { "content-type": "application/json" },
			}),
		);
	});
	return calls;
}

function chatReply(content: unknown): unknown {
	return {
		model: "a/chat-model",
		choices: [{ message: { content: JSON.stringify(content) } }],
		usage: { prompt_tokens: 120, completion_tokens: 8 },
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("the spec", () => {
	it("names the judges it knows and refuses the ones it does not", () => {
		expect(isJudgeName(DEFAULT_JUDGE)).toBe(true);
		expect(isJudgeName("nope")).toBe(false);
		expect(() => judgeSpecFor("nope", specs())).toThrow(
			`unknown judge "nope", expected one of ${JUDGE_NAMES.join(", ")}`,
		);
		expect(judgeSpecFor("openrouter", specs())).toBe(chatSpec);
	});

	it("reports the default first, with its readiness and its calibration", () => {
		expect(judgeReports(specs(), "openrouter")).toEqual([
			{
				name: "openrouter",
				model: "a/chat-model",
				calibrated: false,
				ready: true,
			},
			{
				name: "jev",
				model: "~typesafe/jev-latest",
				calibrated: true,
				ready: false,
			},
		]);
	});

	function specs(): Record<"jev" | "openrouter", JudgeSpec> {
		return {
			jev: { ...decisionsSpec, apiKey: undefined },
			openrouter: chatSpec,
		};
	}
});

describe("the decisions transport", () => {
	it("posts state, model and questions, and nothing else", async () => {
		const calls = stubFetch({
			model: "~typesafe/jev-latest",
			answers: ANSWERS,
			usage: { inputTokens: 900, outputTokens: 12 },
		});

		const judged = await defineJudge(decisionsSpec)({
			state: { said: "hello" },
			questions: QUESTIONS,
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe("https://judge.test/api/alpha/decisions");
		expect(calls[0].headers.authorization).toBe("Bearer sk-test");
		expect(calls[0].body).toEqual({
			state: { said: "hello" },
			model: "~typesafe/jev-latest",
			questions: QUESTIONS,
		});
		expect(judged.answers).toEqual(ANSWERS);
		expect(judged.calibrated).toBe(true);
		expect(judged.usage).toEqual({ inputTokens: 900, outputTokens: 12 });
	});

	it("takes the model the request names", async () => {
		const calls = stubFetch({ model: "~typesafe/jev-2", answers: ANSWERS });

		await defineJudge(decisionsSpec)({
			state: null,
			questions: QUESTIONS,
			model: "~typesafe/jev-2",
		});

		expect(calls[0].body.model).toBe("~typesafe/jev-2");
	});
});

describe("the chat transport", () => {
	it("compiles the questions into a schema and parses the reply back", async () => {
		const calls = stubFetch(
			chatReply({
				worth_keeping: 0.82,
				kind: "procedure",
				kind_confidence: 0.6,
				weight: 2,
				weight_confidence: 0.4,
			}),
		);

		const judged = await defineJudge(chatSpec)({
			state: { said: "hello" },
			questions: QUESTIONS,
		});

		expect(calls[0].url).toBe("https://chat.test/api/v1/chat/completions");
		const format = calls[0].body.response_format as {
			json_schema: { schema: { properties: Record<string, unknown> } };
		};
		expect(format.json_schema.schema.properties).toEqual({
			worth_keeping: { type: "number", minimum: 0, maximum: 1 },
			kind: { type: "string", enum: ["fact", "procedure", "nothing"] },
			kind_confidence: { type: "number", minimum: 0, maximum: 1 },
			weight: { type: "integer", minimum: 0, maximum: 2 },
			weight_confidence: { type: "number", minimum: 0, maximum: 1 },
		});
		expect(judged.answers).toEqual(ANSWERS);
	});

	it("says it is not calibrated, where the decisions endpoint says it is", async () => {
		stubFetch(
			chatReply({
				worth_keeping: 0.1,
				kind: "nothing",
				kind_confidence: 0.9,
				weight: 0,
				weight_confidence: 0.9,
			}),
		);

		expect(
			(await defineJudge(chatSpec)({ state: null, questions: QUESTIONS }))
				.calibrated,
		).toBe(false);
	});

	it("takes a choice distribution off the option tokens when there is one", async () => {
		stubFetch({
			model: "a/chat-model",
			choices: [
				{
					message: {
						content: JSON.stringify({
							kind: "procedure",
							kind_confidence: 0.6,
						}),
					},
					logprobs: {
						content: [
							{
								token: "procedure",
								top_logprobs: [
									{ token: "procedure", logprob: Math.log(0.75) },
									{ token: "fact", logprob: Math.log(0.25) },
								],
							},
						],
					},
				},
			],
		});

		const judged = await defineJudge(chatSpec)({
			state: null,
			questions: { kind: QUESTIONS.kind },
		});
		const answer = judged.answers.kind;

		expect(answer.type).toBe("choice");
		if (answer.type !== "choice") return;
		expect(answer.probabilities.procedure).toBeCloseTo(0.75);
		expect(answer.probabilities.fact).toBeCloseTo(0.25);
		expect(answer.probabilities.nothing).toBe(0);
	});
});

describe("what goes wrong", () => {
	it("names the environment variable when the key is missing", async () => {
		stubFetch({ model: "~typesafe/jev-latest", answers: ANSWERS });

		await expect(
			defineJudge({ ...decisionsSpec, apiKey: undefined })({
				state: null,
				questions: QUESTIONS,
			}),
		).rejects.toThrow("OPENROUTER_API_KEY is not set");
	});

	it("gives up at once on a status it cannot retry", async () => {
		const calls = stubFetch({ error: "no key" }, 401);

		await expect(
			defineJudge(decisionsSpec)({ state: null, questions: QUESTIONS }),
		).rejects.toThrow("Jev answered 401");
		expect(calls).toHaveLength(1);
	});

	it("retries a retryable status and takes the answer", async () => {
		vi.useFakeTimers();
		const calls: string[] = [];
		vi.stubGlobal("fetch", (url: string) => {
			calls.push(url);
			return Promise.resolve(
				calls.length === 1
					? new Response("busy", { status: 429 })
					: new Response(
							JSON.stringify({
								model: "~typesafe/jev-latest",
								answers: ANSWERS,
							}),
							{ status: 200 },
						),
			);
		});

		const judging = defineJudge(decisionsSpec)({
			state: null,
			questions: QUESTIONS,
		});
		await vi.runAllTimersAsync();

		expect((await judging).answers).toEqual(ANSWERS);
		expect(calls).toHaveLength(2);
	});

	it("stops retrying after ATTEMPTS and reports the last status", async () => {
		vi.useFakeTimers();
		const calls = stubFetch({ error: "over quota" }, 429);

		const judging = defineJudge(decisionsSpec)({
			state: null,
			questions: QUESTIONS,
		});
		const settled = expect(judging).rejects.toThrow("Jev answered 429");
		await vi.runAllTimersAsync();
		await settled;

		expect(calls).toHaveLength(ATTEMPTS);
	});

	it("throws on a body that is not an object", async () => {
		stubFetch("[]");

		await expect(
			defineJudge(decisionsSpec)({ state: null, questions: QUESTIONS }),
		).rejects.toThrow("answered with a body that is not an object");
	});

	it("throws on an answer that is missing", async () => {
		stubFetch({
			model: "~typesafe/jev-latest",
			answers: { kind: ANSWERS.kind },
		});

		await expect(
			defineJudge(decisionsSpec)({ state: null, questions: QUESTIONS }),
		).rejects.toThrow("worth_keeping");
	});

	it("throws on a choice outside the criteria it was offered", async () => {
		stubFetch({
			model: "~typesafe/jev-latest",
			answers: {
				...ANSWERS,
				kind: { ...ANSWERS.kind, choice: "something-else" },
			},
		});

		await expect(
			defineJudge(decisionsSpec)({ state: null, questions: QUESTIONS }),
		).rejects.toThrow("which is not one of fact, procedure, nothing");
	});

	it("throws when the chat reply is not JSON", async () => {
		stubFetch({
			model: "a/chat-model",
			choices: [{ message: { content: "sure thing" } }],
		});

		await expect(
			defineJudge(chatSpec)({ state: null, questions: QUESTIONS }),
		).rejects.toThrow("answered with something that is not JSON");
	});
});
