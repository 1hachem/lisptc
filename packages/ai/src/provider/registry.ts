import type { Provider } from "./core.ts";
import { digitalocean } from "./digitalocean.ts";
import { fireworks } from "./fireworks.ts";
import { llamacpp } from "./llamacpp.ts";
import { openrouter } from "./openrouter.ts";

export const providers = {
	digitalocean,
	fireworks,
	llamacpp,
	openrouter,
} satisfies Record<string, Provider>;

export type ProviderName = keyof typeof providers;

export function getProvider(name: ProviderName = "digitalocean"): Provider {
	const provider = providers[name];
	if (!provider) throw new Error(`unknown AI provider: ${name}`);
	return provider;
}
