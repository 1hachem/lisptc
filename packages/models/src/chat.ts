import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import type { ProviderSpec } from "@repo/shared/providers";

export interface ChatOptions {
	model?: string;
	temperature?: number;
	maxTokens?: number;
	streaming?: boolean;
	reasoningEffort?: string | null;
	repeatPenalty?: number | null;
	variant?: string | null;
}

export type ChatProvider = (options?: ChatOptions) => BaseChatModel;

export interface ChatProviderConfig extends ProviderSpec {
	defaults?: ChatOptions;
	variant?: (model: string, variant: string) => string;
}

type Body = Record<string, unknown>;

function given(options: ChatOptions): ChatOptions {
	return Object.fromEntries(
		Object.entries(options).filter(([, value]) => value !== undefined),
	);
}

function bodyOf(options: ChatOptions): Body {
	return {
		...(options.reasoningEffort == null
			? {}
			: { reasoning_effort: options.reasoningEffort }),
		...(options.repeatPenalty == null
			? {}
			: { repetition_penalty: options.repeatPenalty }),
	};
}

export function suffixVariant(model: string, variant: string): string {
	return model.endsWith(`:${variant}`) ? model : `${model}:${variant}`;
}

export function defineChatProvider(config: ChatProviderConfig): ChatProvider {
	return (options = {}) => {
		if (!config.apiKey)
			throw new Error(
				`${config.apiKeyEnv} is not set. Add it to the environment to talk to ${config.label}.`,
			);
		const merged = { ...config.defaults, ...given(options) };
		const model = merged.model ?? config.defaultModel;
		return new ChatOpenAI({
			apiKey: config.apiKey,
			model:
				config.variant && merged.variant
					? config.variant(model, merged.variant)
					: model,
			temperature: merged.temperature,
			maxTokens: merged.maxTokens,
			streaming: merged.streaming ?? true,
			configuration: { baseURL: config.baseUrl },
			modelKwargs: { ...config.body, ...bodyOf(merged) },
		});
	};
}
