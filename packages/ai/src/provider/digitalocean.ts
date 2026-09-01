import { aiEnv } from "@repo/env/ai";
import { defineProvider } from "./core.ts";

// DigitalOcean Gradient serverless inference: one OpenAI-compatible endpoint in
// front of many hosted models — open weights on their own Ray + vLLM pools,
// OpenAI/Anthropic models proxied to the vendor. Auth is a model access key (or
// a DO personal access token) as the bearer token.
//
// Trying vLLM's pre-0.12 spelling, `guided_grammar`, because the other two paths
// are known-closed: DO's gateway answers `structured_outputs` (vLLM's current
// field) with "not a supported request field", and vLLM itself 400s on a grammar
// `response_format`. Being a top-level param, `guided_grammar` at worst reaches
// vLLM and is ignored as an unknown field.
export const digitalocean = defineProvider({
	label: "DigitalOcean inference",
	apiKey: aiEnv.DO_API_KEY,
	apiKeyEnv: "DO_API_KEY",
	baseUrl: aiEnv.DO_BASE_URL ?? "https://inference.do-ai.run/v1",
	defaultModel: aiEnv.DO_MODEL ?? "gemma-4-31B-it",
	//BUG: it seems that digital ocean don't support grammer even thos vLLM does
	grammarBody: null,
});
