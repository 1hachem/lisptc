import { aiEnv } from "@repo/env/ai";
import { DEFAULT_REPEAT_PENALTY, defineProvider, gbnfBody } from "./core.ts";

export const llamacpp = defineProvider({
	label: "the local llama-server",
	apiKey: "llama.cpp",
	apiKeyEnv: "LLAMACPP_API_KEY",
	baseUrl: aiEnv.LLAMACPP_BASE_URL ?? "http://127.0.0.1:8080/v1",
	defaultModel: aiEnv.LLAMACPP_MODEL ?? "gemma-4-E4B-it",
	grammarBody: gbnfBody,
	extraBody: (opts) => ({
		repeat_penalty: opts.repeatPenalty ?? DEFAULT_REPEAT_PENALTY,
		...(opts.repeatLastN !== undefined
			? { repeat_last_n: opts.repeatLastN }
			: {}),
	}),
});
