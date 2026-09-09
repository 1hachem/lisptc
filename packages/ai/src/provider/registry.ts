import { DEFAULT_PROVIDER, type ProviderName } from "@repo/shared/providers";
import { aigrid } from "./aigrid.ts";
import type { Provider } from "./core.ts";
import { digitalocean } from "./digitalocean.ts";
import { fireworks } from "./fireworks.ts";
import { llamacpp } from "./llamacpp.ts";
import { openrouter } from "./openrouter.ts";

export const providers: Record<ProviderName, Provider> = {
	aigrid,
	digitalocean,
	fireworks,
	llamacpp,
	openrouter,
};

export function getProvider(name: ProviderName = DEFAULT_PROVIDER): Provider {
	const provider = providers[name];
	if (!provider) throw new Error(`unknown AI provider: ${name}`);
	return provider;
}
