export interface ProviderSpec {
	label: string;
	apiKey: string | undefined;
	apiKeyEnv: string;
	baseUrl: string;
	defaultModel: string;
	body?: Record<string, unknown>;
}

export const PROVIDER_NAMES = [
	"digitalocean",
	"fireworks",
	"llamacpp",
	"openrouter",
] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

export const DEFAULT_PROVIDER: ProviderName = "digitalocean";

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
