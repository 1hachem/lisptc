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

export const PROVIDER_CATALOG = {
	digitalocean: {
		label: "DigitalOcean",
		models: [{ id: "gemma-4-31B-it", name: "Gemma 4 31B" }],
	},
	openrouter: {
		label: "OpenRouter",
		models: [{ id: "google/gemma-4-31b-it", name: "Gemma 4 31B" }],
	},
} as const satisfies Record<
	ProviderName,
	{ label: string; models: readonly ModelEntry[] }
>;

export type CataloguedChoice = {
	[P in ProviderName]: {
		provider: P;
		model: (typeof PROVIDER_CATALOG)[P]["models"][number]["id"];
	};
}[ProviderName];

export const CATALOGUED_CHOICES: readonly CataloguedChoice[] =
	PROVIDER_NAMES.flatMap((provider) =>
		PROVIDER_CATALOG[provider].models.map(
			(m) => ({ provider, model: m.id }) as CataloguedChoice,
		),
	);

export const DEFAULT_CHOICE: CataloguedChoice = {
	provider: "openrouter",
	model: "google/gemma-4-31b-it",
};

export function isCatalogued(choice: {
	provider: string;
	model: string;
}): choice is CataloguedChoice {
	return CATALOGUED_CHOICES.some(
		(c) => c.provider === choice.provider && c.model === choice.model,
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
