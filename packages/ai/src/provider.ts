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
	// Penalty on already-emitted tokens (1 = off). Under a grammar the model can
	// satisfy the constraint by looping on whitespace forever, so a mild penalty
	// is on by default; pass 1 to disable.
	repeatPenalty?: number;
	// How many recent tokens `repeatPenalty` looks back over (llama.cpp only).
	// Left unset so the server's own default (64) stands.
	repeatLastN?: number;
}

export type Provider = (opts: ModelOptions) => BaseChatModel;

const DEFAULT_FIREWORKS_MODEL = "accounts/fireworks/models/kimi-k3";
const FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";

const DEFAULT_REPEAT_PENALTY = 1.1;

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
		repetition_penalty: opts.repeatPenalty ?? DEFAULT_REPEAT_PENALTY,
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

const DEFAULT_LLAMACPP_MODEL = "gemma-4-E4B-it";
const LLAMACPP_BASE_URL = "http://127.0.0.1:8080/v1";

// Local llama.cpp `llama-server` (see `task serve-gemma`). Exposes an
// OpenAI-compatible endpoint, so ChatOpenAI talks to it directly. It ignores
// the API key but ChatOpenAI insists on a non-empty one.
export const llamacpp: Provider = (opts) => {
	const grammar = opts.grammar === undefined ? LISP_GRAMMAR : opts.grammar;
	// llama-server takes a GBNF `grammar` and the sampling penalties as top-level
	// extensions to the OpenAI body, so they ride through `modelKwargs`. (No
	// `reasoning_effort` — gemma has no thinking channel.)
	const modelKwargs: Record<string, unknown> = {
		repeat_penalty: opts.repeatPenalty ?? DEFAULT_REPEAT_PENALTY,
	};
	if (opts.repeatLastN !== undefined)
		modelKwargs.repeat_last_n = opts.repeatLastN;
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

const DEFAULT_OPENROUTER_MODEL = "google/gemma-4-31b-it:free";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const RATE_LIMIT_RETRIES = 12;
const RATE_LIMIT_RETRY_MS = 5_000;

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		function onAbort() {
			clearTimeout(timer);
			reject(signal?.reason);
		}
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

// OpenRouter serves `:free` models from a pool shared by every free user, which
// 429s ("temporarily rate-limited upstream") on roughly every other call and
// clears again within seconds. LangChain refuses to retry that 429 — with no
// `retry-after` header it classifies it as a capacity error and surfaces it —
// and its own backoff doubles into the minutes, so retry at the transport
// instead: a fixed short delay, many times over. The agent loop makes one call
// per step, so an unretried 429 kills a chat mid-loop.
const rateLimitRetryingFetch: typeof fetch = async (input, init) => {
	const signal = init?.signal;
	for (let attempt = 0; ; attempt++) {
		const response = await fetch(input, init);
		if (response.status !== 429 || attempt >= RATE_LIMIT_RETRIES)
			return response;
		// Nothing has read the body yet; drop it so the connection is reusable.
		await response.body?.cancel();
		await sleep(RATE_LIMIT_RETRY_MS, signal);
	}
};

// OpenRouter fronts many hosted providers behind one OpenAI-compatible endpoint,
// so ChatOpenAI talks to it directly.
export const openrouter: Provider = (opts) => {
	const apiKey = aiEnv.OPENROUTER_API_KEY;
	if (!apiKey) {
		throw new Error(
			"OPENROUTER_API_KEY is not set — add it to your environment (.env) to talk to OpenRouter.",
		);
	}

	const grammar = opts.grammar === undefined ? LISP_GRAMMAR : opts.grammar;
	// OpenRouter has no GBNF field of its own: it forwards unknown body params to
	// the upstream provider and silently drops the ones that provider doesn't
	// accept. So send both spellings we already speak — llama.cpp's top-level
	// `grammar` and Fireworks' grammar `response_format` — and whichever the
	// routed provider understands takes effect. On a provider that supports
	// neither, generation is unconstrained and only the system prompt keeps
	// replies on-dialect.
	const modelKwargs: Record<string, unknown> = {
		repetition_penalty: opts.repeatPenalty ?? DEFAULT_REPEAT_PENALTY,
	};
	if (grammar) {
		modelKwargs.grammar = grammar;
		modelKwargs.response_format = { type: "grammar", grammar };
	}

	return new ChatOpenAI({
		apiKey,
		model: opts.model ?? aiEnv.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL,
		temperature: opts.temperature ?? undefined,
		streaming: opts.streaming ?? true,
		configuration: {
			baseURL: aiEnv.OPENROUTER_BASE_URL ?? OPENROUTER_BASE_URL,
			fetch: rateLimitRetryingFetch,
		},
		modelKwargs,
	});
};

export const providers = { fireworks, llamacpp, openrouter } satisfies Record<
	string,
	Provider
>;

export type ProviderName = keyof typeof providers;

export function getProvider(name: ProviderName = "llamacpp"): Provider {
	const provider = providers[name];
	if (!provider) throw new Error(`unknown AI provider: ${name}`);
	return provider;
}
