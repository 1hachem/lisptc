import { isCatalogued, type ProviderName } from "@repo/shared/providers";

export const RETIRED_MODELS: readonly {
	provider: ProviderName;
	model: string;
}[] = [{ provider: "digitalocean", model: "gemma-4-31B-it" }];

export function retiredModelReset(
	model: { provider: string; model: string } | undefined,
): { model: undefined } | undefined {
	return model === undefined || isCatalogued(model)
		? undefined
		: { model: undefined };
}
