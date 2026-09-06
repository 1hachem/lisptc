import { aiEnv } from "@repo/env/ai";
import { defineProvider, repetitionPenaltyBody } from "./core.ts";

export const openrouter = defineProvider({
	label: "OpenRouter",
	apiKey: aiEnv.OPENROUTER_API_KEY,
	apiKeyEnv: "OPENROUTER_API_KEY",
	baseUrl: aiEnv.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
	defaultModel: aiEnv.OPENROUTER_MODEL ?? "google/gemma-4-31b-it:free",
	extraBody: repetitionPenaltyBody,
});
