// TODO: move provider agnostic types outside
// move fireworks to seperate file

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { aiEnv } from "@repo/env/ai";
import { LISP_GRAMMAR } from "@repo/interpreter/grammar.ts";

export interface ModelOptions {
	model?: string;
	temperature?: number;
	streaming?: boolean;
	// GBNF grammar to constrain generation. Defaults to the lisptc grammar so
	// every token the agent emits is valid REPL source; pass `null` to disable.
	// TODO: default grammer should be null not lisptc
	grammar?: string | null;
	/** Reasoning effort; `"none"` turns off thinking (qwen3p7-plus). */
	// TODO: reasoning effort should be an enum
	reasoningEffort?: string;
}

export type Provider = (opts: ModelOptions) => BaseChatModel;

const DEFAULT_FIREWORKS_MODEL = "accounts/fireworks/models/kimi-k3";
const FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";

export const fireworks: Provider = (opts) => {
	const apiKey = aiEnv.FIREWORKS_API_KEY;
	if (!apiKey) {
		throw new Error(
			"FIREWORKS_API_KEY is not set — add it to your environment (.env) to talk to Fireworks.",
		);
	}

	const grammar = opts.grammar === undefined ? LISP_GRAMMAR : opts.grammar;
	// Grammar-based structured output and reasoning effort are Fireworks
	// extensions to the OpenAI body, so they ride through `modelKwargs`.
	// https://docs.fireworks.ai/structured-responses/structured-output-grammar-based
	const modelKwargs: Record<string, unknown> = {
		reasoning_effort: opts.reasoningEffort ?? "low",
	};
	if (grammar) {
		modelKwargs.response_format = { type: "grammar", grammar };
	}

	return new ChatOpenAI({
		apiKey,
		model: opts.model ?? aiEnv.FIREWORKS_MODEL ?? DEFAULT_FIREWORKS_MODEL,
		temperature: opts.temperature ?? undefined,
		streaming: opts.streaming ?? true,
		configuration: { baseURL: aiEnv.FIREWORKS_BASE_URL ?? FIREWORKS_BASE_URL },
		modelKwargs,
	});
};

const DEFAULT_LLAMACPP_MODEL = "gemma-4-E2B-it";
const LLAMACPP_BASE_URL = "http://127.0.0.1:8080/v1";

// Local llama.cpp `llama-server` (see `task serve-gemma`). Exposes an
// OpenAI-compatible endpoint, so ChatOpenAI talks to it directly. It ignores
// the API key but ChatOpenAI insists on a non-empty one.
export const llamacpp: Provider = (opts) => {
	const grammar = opts.grammar === undefined ? LISP_GRAMMAR : opts.grammar;
	// llama-server takes a GBNF `grammar` as a top-level extension to the
	// OpenAI body, so it rides through `modelKwargs`. (No `reasoning_effort` —
	// gemma has no thinking channel.)
	const modelKwargs: Record<string, unknown> = {};
	if (grammar) modelKwargs.grammar = grammar;

	return new ChatOpenAI({
		apiKey: "llama.cpp",
		model: opts.model ?? aiEnv.LLAMACPP_MODEL ?? DEFAULT_LLAMACPP_MODEL,
		temperature: opts.temperature ?? undefined,
		streaming: opts.streaming ?? true,
		configuration: { baseURL: aiEnv.LLAMACPP_BASE_URL ?? LLAMACPP_BASE_URL },
		modelKwargs,
	});
};

export const providers = { fireworks, llamacpp } satisfies Record<
	string,
	Provider
>;

export type ProviderName = keyof typeof providers;

export function getProvider(name: ProviderName = "llamacpp"): Provider {
	const provider = providers[name];
	if (!provider) throw new Error(`unknown AI provider: ${name}`);
	return provider;
}
