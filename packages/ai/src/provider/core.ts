import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
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

export const DEFAULT_REPEAT_PENALTY = 1.1;

type Body = Record<string, unknown>;

export interface ProviderSpec {
	/** Backend name, used in the missing-key error. */
	label: string;
	/**
	 * The key itself, read from `aiEnv` by the provider. Undefined means the
	 * backend is unreachable, so the spec also names the env var to blame; a local
	 * server that ignores the key passes a literal (ChatOpenAI insists on one).
	 */
	apiKey: string | undefined;
	apiKeyEnv: string;
	baseUrl: string;
	defaultModel: string;
	/**
	 * How this backend spells a GBNF grammar in the request body. Defaults to
	 * every spelling that is safe to send blind, so a new provider is
	 * grammar-constrained without saying anything; narrow it once you know which
	 * one the backend implements, or set `null` for a backend that supports no
	 * grammar at all — then generation is unconstrained and only the system prompt
	 * keeps replies on-dialect.
	 */
	grammarBody?: ((grammar: string) => Body) | null;
	/** Body params beyond the OpenAI schema, other than the grammar. */
	extraBody?: (opts: ModelOptions) => Body;
}

/** llama.cpp takes GBNF as a top-level `grammar` body param. */
export const gbnfBody = (grammar: string): Body => ({ grammar });

/**
 * A grammar `response_format` — the spelling shared by the OpenAI-compatible
 * providers that implement grammars at all, and so the default here.
 * https://docs.fireworks.ai/structured-responses/structured-output-grammar-based
 */
const grammarResponseFormat = (grammar: string): Body => ({
	response_format: { type: "grammar", grammar },
});

// Constraining generation is the point of this package — an unconstrained model
// emits prose the REPL can't evaluate — so a provider is grammar-constrained
// unless its spec says otherwise.
const defaultGrammarBody = grammarResponseFormat;

/** The penalty spelling shared by the hosted OpenAI-compatible backends. */
export const repetitionPenaltyBody = (opts: ModelOptions): Body => ({
	repetition_penalty: opts.repeatPenalty ?? DEFAULT_REPEAT_PENALTY,
});

/**
 * Turns a spec into a `Provider`. Every backend we talk to is OpenAI-compatible,
 * so this owns the whole construction and specs carry only what differs.
 */
export function defineProvider(spec: ProviderSpec): Provider {
	return (opts) => {
		const { apiKey } = spec;
		if (!apiKey) {
			throw new Error(
				`${spec.apiKeyEnv} is not set — add it to your environment (.env) to talk to ${spec.label}.`,
			);
		}

		const grammar = opts.grammar === undefined ? LISP_GRAMMAR : opts.grammar;
		const grammarBody =
			spec.grammarBody === undefined ? defaultGrammarBody : spec.grammarBody;

		return new ChatOpenAI({
			apiKey,
			model: opts.model ?? spec.defaultModel,
			temperature: opts.temperature ?? undefined,
			streaming: opts.streaming ?? true,
			configuration: { baseURL: spec.baseUrl },
			modelKwargs: {
				...spec.extraBody?.(opts),
				...(grammar && grammarBody ? grammarBody(grammar) : {}),
			},
		});
	};
}
