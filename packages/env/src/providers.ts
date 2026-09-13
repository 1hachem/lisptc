import {
	DEFAULT_PROVIDER,
	PROVIDER_NAMES,
	type ProviderName,
	type ProviderSpec,
} from "@repo/shared/providers";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { invalid } from "./errors.ts";

const providersEnv = createEnv({
	server: {
		LLM_PROVIDER: z.enum(PROVIDER_NAMES).default(DEFAULT_PROVIDER),
		DO_API_KEY: z.string().optional(),
		DO_BASE_URL: z.url().default("https://inference.do-ai.run/v1"),
		DO_MODEL: z.string().default("gemma-4-31B-it"),
		FIREWORKS_API_KEY: z.string().optional(),
		FIREWORKS_BASE_URL: z
			.url()
			.default("https://api.fireworks.ai/inference/v1"),
		FIREWORKS_MODEL: z.string().default("accounts/fireworks/models/kimi-k3"),
		OPENROUTER_API_KEY: z.string().optional(),
		OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
		OPENROUTER_MODEL: z.string().default("google/gemma-4-31b-it"),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
	onValidationError: invalid("provider"),
});

type ApiKeyEnv = Extract<keyof typeof providersEnv, `${string}_API_KEY`>;

function key(apiKeyEnv: ApiKeyEnv): Pick<ProviderSpec, "apiKey" | "apiKeyEnv"> {
	return { apiKeyEnv, apiKey: providersEnv[apiKeyEnv] };
}

export const defaultProvider: ProviderName = providersEnv.LLM_PROVIDER;

export const providerSpecs: Record<ProviderName, ProviderSpec> = {
	digitalocean: {
		label: "DigitalOcean inference",
		...key("DO_API_KEY"),
		baseUrl: providersEnv.DO_BASE_URL,
		defaultModel: providersEnv.DO_MODEL,
	},
	fireworks: {
		label: "Fireworks",
		...key("FIREWORKS_API_KEY"),
		baseUrl: providersEnv.FIREWORKS_BASE_URL,
		defaultModel: providersEnv.FIREWORKS_MODEL,
	},
	openrouter: {
		label: "OpenRouter",
		...key("OPENROUTER_API_KEY"),
		baseUrl: providersEnv.OPENROUTER_BASE_URL,
		defaultModel: providersEnv.OPENROUTER_MODEL,
	},
};
