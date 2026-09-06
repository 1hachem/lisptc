import { aiEnv } from "@repo/env/ai";
import { defineProvider, repetitionPenaltyBody } from "./core.ts";

export const fireworks = defineProvider({
	label: "Fireworks",
	apiKey: aiEnv.FIREWORKS_API_KEY,
	apiKeyEnv: "FIREWORKS_API_KEY",
	baseUrl: aiEnv.FIREWORKS_BASE_URL ?? "https://api.fireworks.ai/inference/v1",
	defaultModel: aiEnv.FIREWORKS_MODEL ?? "accounts/fireworks/models/kimi-k3",
	extraBody: (opts) => ({
		reasoning_effort: opts.reasoningEffort ?? "low",
		...repetitionPenaltyBody(opts),
	}),
});
