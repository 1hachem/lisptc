import { aiEnv } from "@repo/env/ai";
import { defineProvider, repetitionPenaltyBody } from "./core.ts";

export const digitalocean = defineProvider({
	label: "DigitalOcean inference",
	apiKey: aiEnv.DO_API_KEY,
	apiKeyEnv: "DO_API_KEY",
	baseUrl: aiEnv.DO_BASE_URL ?? "https://inference.do-ai.run/v1",
	defaultModel: aiEnv.DO_MODEL ?? "gemma-4-31B-it",
	extraBody: repetitionPenaltyBody,
	grammarBody: null,
});
