import { aiEnv } from "@repo/env/ai";
import { defineProvider, repetitionPenaltyBody } from "./core.ts";

// OpenRouter fronts many hosted providers behind one OpenAI-compatible endpoint.
// It has no grammar field of its own: it forwards unknown body params to the
// upstream provider and silently drops the ones that provider doesn't accept, so
// the default spelling rides through and takes effect only where the routed
// provider understands it.
export const openrouter = defineProvider({
	label: "OpenRouter",
	apiKey: aiEnv.OPENROUTER_API_KEY,
	apiKeyEnv: "OPENROUTER_API_KEY",
	baseUrl: aiEnv.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
	defaultModel: aiEnv.OPENROUTER_MODEL ?? "google/gemma-4-31b-it:free",
	extraBody: repetitionPenaltyBody,
});
