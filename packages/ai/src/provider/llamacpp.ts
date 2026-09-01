import { aiEnv } from "@repo/env/ai";
import { DEFAULT_REPEAT_PENALTY, defineProvider, gbnfBody } from "./core.ts";

// Local llama.cpp `llama-server` (see `task serve-gemma`). It takes the GBNF
// grammar and the sampling penalties as top-level extensions to the OpenAI body,
// and has no `reasoning_effort` — gemma has no thinking channel. The server
// ignores the API key, but ChatOpenAI insists on a non-empty one.
//
// Not the default `response_format` spelling: llama-server's chat endpoint
// implements `response_format` only for `json_object`/`json_schema` and raises on
// a type it doesn't know, so the grammar goes in the top-level field it reads.
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
