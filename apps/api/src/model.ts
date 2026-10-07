import type { ProviderName } from "@repo/ai";
import {
	DEFAULT_CHOICE,
	isCatalogued,
	isProviderName,
} from "@repo/shared/providers";

export function chatModel(chosen?: { provider: string; model: string }): {
	provider: ProviderName;
	model: string;
} {
	if (
		chosen &&
		isProviderName(chosen.provider) &&
		isCatalogued(chosen.provider, chosen.model)
	)
		return { provider: chosen.provider, model: chosen.model };
	return DEFAULT_CHOICE;
}
