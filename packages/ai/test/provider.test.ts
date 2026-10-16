import type { ChatOpenAI } from "@langchain/openai";
import { describe, expect, test } from "vitest";
import { defineProvider } from "../src/provider/core.ts";

const spec = {
	label: "Test",
	apiKey: "key",
	apiKeyEnv: "TEST_API_KEY",
	baseUrl: "https://example.test/v1",
	defaultModel: "vendor/model",
};

const modelOf = (provider: ReturnType<typeof defineProvider>, model?: string) =>
	(provider({ model }) as ChatOpenAI).model;

describe("defineProvider", () => {
	test("a provider without a variant asks for the model as named", () => {
		expect(modelOf(defineProvider(spec), "vendor/other")).toBe("vendor/other");
	});

	test("a variant is applied to a pinned model and to the default", () => {
		const nitro = defineProvider({
			...spec,
			variant: (model) => `${model}:nitro`,
		});
		expect(modelOf(nitro, "vendor/other")).toBe("vendor/other:nitro");
		expect(modelOf(nitro)).toBe("vendor/model:nitro");
	});
});
