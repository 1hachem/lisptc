import { providerSpecs } from "@repo/env/providers";
import { DEFAULT_PROVIDER, type ProviderName } from "@repo/shared/providers";
import {
	type ChatProvider,
	type ChatProviderConfig,
	defineChatProvider,
	suffixVariant,
} from "./chat.ts";
import { openRouterEmbedding } from "./embedding.ts";
import { openRouterSystemOne } from "./system-one.ts";

export const DEFAULT_REPEAT_PENALTY = 1.1;

export const chatProviderConfigs: Record<ProviderName, ChatProviderConfig> = {
	digitalocean: {
		...providerSpecs.digitalocean,
		defaults: {
			reasoningEffort: "low",
			repeatPenalty: DEFAULT_REPEAT_PENALTY,
		},
	},
	openrouter: {
		...providerSpecs.openrouter,
		defaults: { variant: "nitro", repeatPenalty: DEFAULT_REPEAT_PENALTY },
		variant: suffixVariant,
	},
};

export const chatProviders: Record<ProviderName, ChatProvider> = {
	digitalocean: defineChatProvider(chatProviderConfigs.digitalocean),
	openrouter: defineChatProvider(chatProviderConfigs.openrouter),
};

export function getChatProvider(
	name: ProviderName = DEFAULT_PROVIDER,
): ChatProvider {
	const provider = chatProviders[name];
	if (!provider) throw new Error(`unknown AI provider: ${name}`);
	return provider;
}

export function resolveModel(
	provider: ProviderName = DEFAULT_PROVIDER,
	model?: string,
): { provider: ProviderName; model: string } {
	return {
		provider,
		model: model ?? providerSpecs[provider].defaultModel,
	};
}

export const jev = openRouterSystemOne(providerSpecs.openrouter);

export const openRouterEmbedder = openRouterEmbedding(providerSpecs.openrouter);
