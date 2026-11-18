import type { ChatOpenAI } from "@langchain/openai";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	type ChatOptions,
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

const built = (
	provider: ReturnType<typeof defineChatProvider>,
	options?: ChatOptions,
) => provider(options) as ChatOpenAI;

async function sent(
	provider: ReturnType<typeof defineChatProvider>,
	options: ChatOptions = {},
): Promise<Record<string, unknown>> {
	const bodies: Record<string, unknown>[] = [];
	vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
		bodies.push(JSON.parse(String(init?.body)));
		return new Response(
			JSON.stringify({
				id: "chat-1",
				object: "chat.completion",
				created: 0,
				model: "vendor/model",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "ok" },
						finish_reason: "stop",
					},
				],
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	});
	await provider({ ...options, streaming: false }).invoke("hi");
	const [body] = bodies;
	if (!body) throw new Error("nothing was sent");
	return body;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("defineChatProvider", () => {
	test("a provider without a variant asks for the model as named", async () => {
		expect(
			(await sent(defineChatProvider(spec), { model: "vendor/other" })).model,
		).toBe("vendor/other");
	});

	test("a default variant is applied to a pinned model and to the default", async () => {
		expect((await sent(openRouterLike, { model: "vendor/other" })).model).toBe(
			"vendor/other:nitro",
		);
		expect((await sent(openRouterLike)).model).toBe("vendor/model:nitro");
	});

	test("a variant already on the model is not added twice", () => {
		expect(built(openRouterLike, { model: "vendor/other:nitro" }).model).toBe(
			"vendor/other:nitro",
		);
	});

	test("a caller turns a default off with null", async () => {
		const body = await sent(openRouterLike, {
			variant: null,
			repeatPenalty: null,
		});
		expect(body.model).toBe("vendor/model");
		expect(body).not.toHaveProperty("repetition_penalty");
	});

	test("a caller overrides a default and adds what the provider leaves out", async () => {
		expect(
			await sent(openRouterLike, {
				repeatPenalty: 1.3,
				reasoningEffort: "high",
			}),
		).toMatchObject({ repetition_penalty: 1.3, reasoning_effort: "high" });
	});

	test("the provider's defaults go out when the caller says nothing", async () => {
		const body = await sent(openRouterLike);
		expect(body.repetition_penalty).toBe(1.1);
		expect(body).not.toHaveProperty("reasoning_effort");
	});

	test("a missing key names the variable to set", () => {
		const keyless = defineChatProvider({ ...spec, apiKey: undefined });
		expect(() => keyless()).toThrow("TEST_API_KEY is not set");
	});
});
