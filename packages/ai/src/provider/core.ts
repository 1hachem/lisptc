import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import type { ProviderSpec as SharedProviderSpec } from "@repo/shared/providers";

export interface ModelOptions {
	model?: string;
	temperature?: number;
	streaming?: boolean;
	reasoningEffort?: string;
	repeatPenalty?: number;
}

export type Provider = (opts: ModelOptions) => BaseChatModel;

const DEFAULT_REPEAT_PENALTY = 1.1;

type Body = Record<string, unknown>;

export type ProviderSpec = SharedProviderSpec & {
	extraBody?: (opts: ModelOptions) => Body;
};

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

		return new ChatOpenAI({
			apiKey,
			model: opts.model ?? spec.defaultModel,
			temperature: opts.temperature ?? undefined,
			streaming: opts.streaming ?? true,
			configuration: { baseURL: spec.baseUrl },
			modelKwargs: {
				...spec.body,
				...spec.extraBody?.(opts),
			},
		});
	};
}
