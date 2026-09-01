import { aiEnv } from "@repo/env/ai";
import { defineProvider, repetitionPenaltyBody } from "./core.ts";

// DigitalOcean Gradient serverless inference: one OpenAI-compatible endpoint in
// front of many hosted models — open weights on their own Ray + vLLM pools,
// OpenAI/Anthropic models proxied to the vendor. Auth is a model access key (or
// a DO personal access token) as the bearer token.
//
// No grammar reaches the vLLM behind the gateway, whichever spelling is tried:
// `structured_outputs` (vLLM's current field) comes back "not a supported request
// field", a grammar `response_format` 400s against vLLM's closed union, and the
// pre-0.12 `guided_grammar` has no effect. Replies stay on-dialect by system
// prompt plus the chat loop's `checkSyntax` repair pass.
export const digitalocean = defineProvider({
	label: "DigitalOcean inference",
	apiKey: aiEnv.DO_API_KEY,
	apiKeyEnv: "DO_API_KEY",
	baseUrl: aiEnv.DO_BASE_URL ?? "https://inference.do-ai.run/v1",
	defaultModel: aiEnv.DO_MODEL ?? "gemma-4-31B-it",
	extraBody: repetitionPenaltyBody,
	//BUG: it seems that digitalocean doesn't support grammer even tho vLLM does
	grammarBody: null,
});
