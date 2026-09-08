import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const aiEnv = createEnv({
	server: {
		FIREWORKS_API_KEY: z.string().optional(),
		FIREWORKS_MODEL: z.string().optional(),
		FIREWORKS_BASE_URL: z.string().optional(),
		LLAMACPP_MODEL: z.string().optional(),
		LLAMACPP_BASE_URL: z.string().optional(),
		LLAMACPP_SLOT_DIR: z.string().optional(),
		OPENROUTER_API_KEY: z.string().optional(),
		OPENROUTER_MODEL: z.string().optional(),
		OPENROUTER_BASE_URL: z.string().optional(),
		DO_API_KEY: z.string().optional(),
		DO_MODEL: z.string().optional(),
		DO_BASE_URL: z.string().optional(),
		LLM_PROVIDER: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});

export interface ProviderSpec {
	label: string;
	apiKey: string | undefined;
	apiKeyEnv: string;
	baseUrl: string;
	defaultModel: string;
}

export const providerSpecs = {
	digitalocean: {
		label: "DigitalOcean inference",
		apiKey: aiEnv.DO_API_KEY,
		apiKeyEnv: "DO_API_KEY",
		baseUrl: aiEnv.DO_BASE_URL ?? "https://inference.do-ai.run/v1",
		defaultModel: aiEnv.DO_MODEL ?? "gemma-4-31B-it",
	},
	fireworks: {
		label: "Fireworks",
		apiKey: aiEnv.FIREWORKS_API_KEY,
		apiKeyEnv: "FIREWORKS_API_KEY",
		baseUrl:
			aiEnv.FIREWORKS_BASE_URL ?? "https://api.fireworks.ai/inference/v1",
		defaultModel: aiEnv.FIREWORKS_MODEL ?? "accounts/fireworks/models/kimi-k3",
	},
	llamacpp: {
		label: "the local llama-server",
		apiKey: "llama.cpp",
		apiKeyEnv: "LLAMACPP_API_KEY",
		baseUrl: aiEnv.LLAMACPP_BASE_URL ?? "http://127.0.0.1:8080/v1",
		defaultModel: aiEnv.LLAMACPP_MODEL ?? "gemma-4-E4B-it",
	},
	openrouter: {
		label: "OpenRouter",
		apiKey: aiEnv.OPENROUTER_API_KEY,
		apiKeyEnv: "OPENROUTER_API_KEY",
		baseUrl: aiEnv.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
		defaultModel: aiEnv.OPENROUTER_MODEL ?? "google/gemma-4-31b-it:free",
	},
} satisfies Record<string, ProviderSpec>;

export type ProviderName = keyof typeof providerSpecs;

export const providerNames = Object.keys(providerSpecs) as ProviderName[];

export const DEFAULT_PROVIDER: ProviderName = "digitalocean";
