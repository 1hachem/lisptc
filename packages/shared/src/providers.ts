export interface ProviderSpec {
	label: string;
	apiKey: string | undefined;
	apiKeyEnv: string;
	baseUrl: string;
	baseUrlEnv: string;
	defaultModel: string;
}

export type Env = Record<string, string | undefined>;

export const PROVIDER_NAMES = [
	"aigrid",
	"digitalocean",
	"fireworks",
	"llamacpp",
	"openrouter",
] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

export const DEFAULT_PROVIDER: ProviderName = "digitalocean";

export const PROVIDER_ENV_VAR = "LLM_PROVIDER";

function set(env: Env, key: string): string | undefined {
	const raw = env[key];
	return raw === undefined || raw === "" ? undefined : raw;
}

export function buildProviderSpecs(
	env: Env = process.env,
): Record<ProviderName, ProviderSpec> {
	return {
		aigrid: {
			label: "AI Grid",
			apiKey: set(env, "AI_GRID_API_KEY"),
			apiKeyEnv: "AI_GRID_API_KEY",
			baseUrl: set(env, "AI_GRID_BASE_URL") ?? "",
			baseUrlEnv: "AI_GRID_BASE_URL",
			defaultModel: set(env, "AI_GRID_MODEL") ?? "Qwen/Qwen3.8-27B",
		},
		digitalocean: {
			label: "DigitalOcean inference",
			apiKey: set(env, "DO_API_KEY"),
			apiKeyEnv: "DO_API_KEY",
			baseUrl: set(env, "DO_BASE_URL") ?? "https://inference.do-ai.run/v1",
			baseUrlEnv: "DO_BASE_URL",
			defaultModel: set(env, "DO_MODEL") ?? "gemma-4-31B-it",
		},
		fireworks: {
			label: "Fireworks",
			apiKey: set(env, "FIREWORKS_API_KEY"),
			apiKeyEnv: "FIREWORKS_API_KEY",
			baseUrl:
				set(env, "FIREWORKS_BASE_URL") ??
				"https://api.fireworks.ai/inference/v1",
			baseUrlEnv: "FIREWORKS_BASE_URL",
			defaultModel:
				set(env, "FIREWORKS_MODEL") ?? "accounts/fireworks/models/kimi-k3",
		},
		llamacpp: {
			label: "the local llama-server",
			apiKey: "llama.cpp",
			apiKeyEnv: "LLAMACPP_API_KEY",
			baseUrl: set(env, "LLAMACPP_BASE_URL") ?? "http://127.0.0.1:8080/v1",
			baseUrlEnv: "LLAMACPP_BASE_URL",
			defaultModel: set(env, "LLAMACPP_MODEL") ?? "gemma-4-E4B-it",
		},
		openrouter: {
			label: "OpenRouter",
			apiKey: set(env, "OPENROUTER_API_KEY"),
			apiKeyEnv: "OPENROUTER_API_KEY",
			baseUrl:
				set(env, "OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1",
			baseUrlEnv: "OPENROUTER_BASE_URL",
			defaultModel:
				set(env, "OPENROUTER_MODEL") ?? "google/gemma-4-31b-it:free",
		},
	};
}

export const providerSpecs: Record<ProviderName, ProviderSpec> =
	buildProviderSpecs();

export function isProviderName(name: string): name is ProviderName {
	return (PROVIDER_NAMES as readonly string[]).includes(name);
}

function expected(): string {
	return PROVIDER_NAMES.join(", ");
}

export function defaultProviderName(env: Env = process.env): ProviderName {
	const configured = set(env, PROVIDER_ENV_VAR);
	if (configured === undefined) return DEFAULT_PROVIDER;
	if (!isProviderName(configured))
		throw new Error(
			`${PROVIDER_ENV_VAR} is "${configured}", but expected one of ${expected()}`,
		);
	return configured;
}

export function providerSpecFor(
	name: string,
	specs: Record<ProviderName, ProviderSpec> = providerSpecs,
): ProviderSpec {
	if (!isProviderName(name))
		throw new Error(
			`unknown provider "${name}", expected one of ${expected()}`,
		);
	return specs[name];
}

export function assertReachable(spec: ProviderSpec): void {
	const missing = spec.apiKey === undefined ? spec.apiKeyEnv : undefined;
	const blank = spec.baseUrl === "" ? spec.baseUrlEnv : undefined;
	const unset = [missing, blank].filter((name) => name !== undefined);
	if (unset.length > 0)
		throw new Error(
			`${unset.join(" and ")} ${unset.length > 1 ? "are" : "is"} not set. Add ${unset.length > 1 ? "them" : "it"} to your environment (.env) to talk to ${spec.label}.`,
		);
}
