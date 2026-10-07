import type { ProviderName } from "@repo/ai";
import { providerSpecs } from "@repo/env/providers";
import { DEFAULT_PROVIDER, isProviderName } from "@repo/shared/providers";

export function chatModel(chosen?: { provider: string; model: string }): {
	provider: ProviderName;
	model: string;
} {
	if (chosen && isProviderName(chosen.provider))
		return { provider: chosen.provider, model: chosen.model };
	return {
		provider: DEFAULT_PROVIDER,
		model: providerSpecs[DEFAULT_PROVIDER].defaultModel,
	};
}
