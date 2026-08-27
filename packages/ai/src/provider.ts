import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { aiEnv } from "@repo/env/ai";
import { LISP_GRAMMAR } from "@repo/interpreter/grammar.ts";

export interface ModelOptions {
	model?: string;
	temperature?: number;
	streaming?: boolean;
	/**
	 * GBNF grammar to constrain generation. Defaults to the lisptc grammar so
	 * every token the agent emits is valid REPL source; pass `null` to disable.
	 */
	grammar?: string | null;
	/** Reasoning effort; `"none"` turns off thinking (qwen3p7-plus). */
	reasoningEffort?: string;
}

/**
 * A provider is just a factory for a LangChain chat model, so the agent stays
 * decoupled from any single vendor. Swap providers by registering another one
 * in `providers` and selecting it via `AI_PROVIDER`.
 */
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
	// Fireworks speaks the OpenAI wire protocol, so ChatOpenAI + a base URL is
	// all it takes; swapping to another OpenAI-compatible host is a URL change.
	return new ChatOpenAI({
		apiKey,
		model: opts.model ?? aiEnv.FIREWORKS_MODEL ?? DEFAULT_FIREWORKS_MODEL,
		temperature: opts.temperature ?? undefined,
		streaming: opts.streaming ?? true,
		configuration: { baseURL: aiEnv.FIREWORKS_BASE_URL ?? FIREWORKS_BASE_URL },
		modelKwargs,
	});
};

export const providers = { fireworks } satisfies Record<string, Provider>;

export type ProviderName = keyof typeof providers;

export function getProvider(name: ProviderName = "fireworks"): Provider {
	const provider = providers[name];
	if (!provider) throw new Error(`unknown AI provider: ${name}`);
	return provider;
}
