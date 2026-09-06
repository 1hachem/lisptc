import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { LISP_GRAMMAR } from "@repo/interpreter/grammar";

export interface ModelOptions {
	model?: string;
	temperature?: number;
	streaming?: boolean;
	grammar?: string | null;
	reasoningEffort?: string;
	repeatPenalty?: number;
	repeatLastN?: number;
}

export type Provider = (opts: ModelOptions) => BaseChatModel;

export const DEFAULT_REPEAT_PENALTY = 1.1;

type Body = Record<string, unknown>;

export interface ProviderSpec {
	label: string;
	apiKey: string | undefined;
	apiKeyEnv: string;
	baseUrl: string;
	defaultModel: string;
	grammarBody?: ((grammar: string) => Body) | null;
	extraBody?: (opts: ModelOptions) => Body;
}

export const gbnfBody = (grammar: string): Body => ({ grammar });

const grammarResponseFormat = (grammar: string): Body => ({
	response_format: { type: "grammar", grammar },
});

const defaultGrammarBody = grammarResponseFormat;

export const repetitionPenaltyBody = (opts: ModelOptions): Body => ({
	repetition_penalty: opts.repeatPenalty ?? DEFAULT_REPEAT_PENALTY,
});

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
