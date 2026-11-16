import type { ChatOpenAI } from "@langchain/openai";
import { describe, expect, test } from "vitest";
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

describe("defineChatProvider", () => {
	test("a provider without a variant asks for the model as named", () => {
		expect(
			built(defineChatProvider(spec), { model: "vendor/other" }).model,
		).toBe("vendor/other");
	});

	test("a default variant is applied to a pinned model and to the default", () => {
		expect(built(openRouterLike, { model: "vendor/other" }).model).toBe(
			"vendor/other:nitro",
		);
		expect(built(openRouterLike).model).toBe("vendor/model:nitro");
	});

	test("a variant already on the model is not added twice", () => {
		expect(built(openRouterLike, { model: "vendor/other:nitro" }).model).toBe(
			"vendor/other:nitro",
		);
	});

	test("a caller turns a default off with null", () => {
		const model = built(openRouterLike, { variant: null, repeatPenalty: null });
		expect(model.model).toBe("vendor/model");
		expect(model.modelKwargs).toEqual({});
	});

	test("a caller overrides a default and adds what the provider leaves out", () => {
		const model = built(openRouterLike, {
			repeatPenalty: 1.3,
			reasoningEffort: "high",
		});
		expect(model.modelKwargs).toEqual({
			repetition_penalty: 1.3,
			reasoning_effort: "high",
		});
	});

	test("the provider's defaults go out when the caller says nothing", () => {
		expect(built(openRouterLike).modelKwargs).toEqual({
			repetition_penalty: 1.1,
		});
	});

	test("a missing key names the variable to set", () => {
		const keyless = defineChatProvider({ ...spec, apiKey: undefined });
		expect(() => keyless()).toThrow("TEST_API_KEY is not set");
	});
});
