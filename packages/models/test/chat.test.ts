import OpenAI from "openai";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	type ChatDelta,
	defineChatProvider,
	suffixVariant,
} from "../src/chat.ts";

const spec = {
	label: "Test",
	apiKey: "key",
	apiKeyEnv: "TEST_API_KEY",
	baseUrl: "https://example.test/v1",
	defaultModel: "vendor/model",
};

const openRouterLike = defineChatProvider({
	...spec,
	defaults: { variant: "nitro", repeatPenalty: 1.1 },
	variant: suffixVariant,
});

const sent: Record<string, unknown>[] = [];

function answer(response: () => Response): void {
	vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
		sent.push(JSON.parse(String(init?.body)));
		return response();
	});
}

function completion(content: string): Response {
	return Response.json({
		id: "1",
		object: "chat.completion",
		created: 1,
		model: "stub",
		choices: [
			{
				index: 0,
				message: { role: "assistant", content },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
	});
}

function events(chunks: object[]): Response {
	const body = [
		...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
		"data: [DONE]\n\n",
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

function chunk(delta: object, usage: object | null = null): object {
	return {
		id: "1",
		object: "chat.completion.chunk",
		created: 1,
		model: "stub",
		choices: usage ? [] : [{ index: 0, delta, finish_reason: null }],
		usage,
	};
}

async function sentBy(
	provider: ReturnType<typeof defineChatProvider>,
	options?: Parameters<ReturnType<typeof defineChatProvider>>[0],
): Promise<Record<string, unknown>> {
	answer(() => completion("ok"));
	await provider(options).complete([{ role: "user", content: "hi" }]);
	return sent.at(-1) ?? {};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("defineChatProvider", () => {
	test("a provider without a variant asks for the model as named", () => {
		expect(defineChatProvider(spec)({ model: "vendor/other" }).model).toBe(
			"vendor/other",
		);
	});

	test("a default variant is applied to a pinned model and to the default", () => {
		expect(openRouterLike({ model: "vendor/other" }).model).toBe(
			"vendor/other:nitro",
		);
		expect(openRouterLike().model).toBe("vendor/model:nitro");
	});

	test("a variant already on the model is not added twice", () => {
		expect(openRouterLike({ model: "vendor/other:nitro" }).model).toBe(
			"vendor/other:nitro",
		);
	});

	test("a caller turns a default off with null", async () => {
		const body = await sentBy(openRouterLike, {
			variant: null,
			repeatPenalty: null,
		});
		expect(body.model).toBe("vendor/model");
		expect(body).not.toHaveProperty("repetition_penalty");
		expect(body).not.toHaveProperty("reasoning_effort");
	});

	test("a caller overrides a default and adds what the provider leaves out", async () => {
		const body = await sentBy(openRouterLike, {
			repeatPenalty: 1.3,
			reasoningEffort: "high",
		});
		expect(body).toMatchObject({
			repetition_penalty: 1.3,
			reasoning_effort: "high",
		});
	});

	test("the provider's defaults go out when the caller says nothing", async () => {
		expect(await sentBy(openRouterLike)).toMatchObject({
			model: "vendor/model:nitro",
			repetition_penalty: 1.1,
		});
	});

	test("a missing key names the variable to set", () => {
		const keyless = defineChatProvider({ ...spec, apiKey: undefined });
		expect(() => keyless()).toThrow("TEST_API_KEY is not set");
	});

	test("a client hands the request the fields it reads", async () => {
		const body = await sentBy(defineChatProvider(spec), {
			client: {
				open: (options) => new OpenAI(options),
				body: { trace: "abc" },
			},
		});
		expect(body.trace).toBe("abc");
	});
});

describe("a chat model", () => {
	test("streams the reasoning, the text and the usage, and asks for the usage", async () => {
		answer(() =>
			events([
				chunk({ reasoning_content: "think" }),
				chunk({ content: "hel" }),
				chunk({ content: "lo" }),
				chunk(
					{},
					{
						prompt_tokens: 20,
						completion_tokens: 2,
						total_tokens: 22,
						prompt_tokens_details: { cached_tokens: 8 },
					},
				),
			]),
		);
		const deltas: ChatDelta[] = [];
		for await (const delta of defineChatProvider(spec)().stream([
			{ role: "user", content: "hi" },
		]))
			deltas.push(delta);
		expect(deltas).toEqual([
			{ reasoning: "think" },
			{ text: "hel" },
			{ text: "lo" },
			{ usage: { input: 20, output: 2, cachedInput: 8 } },
		]);
		expect(sent.at(-1)).toMatchObject({
			stream: true,
			stream_options: { include_usage: true },
		});
	});

	test("completes with the text and the token counts", async () => {
		answer(() => completion("hello"));
		const reply = await defineChatProvider(spec)().complete([
			{ role: "user", content: "hi" },
		]);
		expect(reply).toEqual({ text: "hello", usage: { input: 12, output: 3 } });
	});

	test("constrains a completion to a schema and parses the answer", async () => {
		answer(() => completion('{"n":1}'));
		const schema = {
			type: "object",
			properties: { n: { type: "number" } },
		};
		const reply = await defineChatProvider(spec)().complete(
			[{ role: "user", content: "one" }],
			{ schema: { name: "count", schema } },
		);
		expect(reply.value).toEqual({ n: 1 });
		expect(sent.at(-1)?.response_format).toEqual({
			type: "json_schema",
			json_schema: { name: "count", schema },
		});
	});
});
