export interface ProviderSpec {
	label: string;
	apiKey: string | undefined;
	apiKeyEnv: string;
	baseUrl: string;
	defaultModel: string;
	body?: Record<string, unknown>;
}

export const PROVIDER_NAMES = ["digitalocean", "openrouter"] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

export const DEFAULT_PROVIDER: ProviderName = "openrouter";

export interface ModelEntry {
	id: string;
	name: string;
}

const GEMMA_ON_OPENROUTER: ModelEntry = {
	id: "google/gemma-4-31b-it",
	name: "Gemma 4 31B",
};

export const DEFAULT_CHOICE: { provider: ProviderName; model: string } = {
	provider: DEFAULT_PROVIDER,
	model: GEMMA_ON_OPENROUTER.id,
};

export const PROVIDER_CATALOG: Record<
	ProviderName,
	{ label: string; models: readonly ModelEntry[] }
> = {
	digitalocean: {
		label: "DigitalOcean",
		models: [{ id: "gemma-4-31B-it", name: "Gemma 4 31B" }],
	},
	openrouter: {
		label: "OpenRouter",
		models: [GEMMA_ON_OPENROUTER],
	},
};

export function isCatalogued(provider: string, model: string): boolean {
	return (
		isProviderName(provider) &&
		PROVIDER_CATALOG[provider].models.some((m) => m.id === model)
	);
}

export function isProviderName(name: string): name is ProviderName {
	return (PROVIDER_NAMES as readonly string[]).includes(name);
}

export function providerSpecFor(
	name: string,
	specs: Record<ProviderName, ProviderSpec>,
): ProviderSpec {
	if (!isProviderName(name))
		throw new Error(
			`unknown provider "${name}", expected one of ${PROVIDER_NAMES.join(", ")}`,
		);
	return specs[name];
}
