import { evalsEnv } from "@repo/env/evals";
import { defaultProvider, providerSpecs } from "@repo/env/providers";
import {
	isProviderName,
	type ProviderName,
	providerSpecFor,
} from "@repo/shared/providers";

export interface Target {
	provider: ProviderName;
	model: string;
}

export function evalMatrix(): Target[] {
	const raw = evalsEnv.EVAL_MATRIX;
	if (!raw) {
		const provider = defaultProvider;
		return [
			{
				provider,
				model: providerSpecFor(provider, providerSpecs).defaultModel,
			},
		];
	}
	return raw
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const at = entry.indexOf(":");
			const name = at === -1 ? entry : entry.slice(0, at);
			if (!isProviderName(name))
				throw new Error(`EVAL_MATRIX names an unknown provider: ${name}`);
			const model = at === -1 ? "" : entry.slice(at + 1);
			return {
				provider: name,
				model: model || providerSpecFor(name, providerSpecs).defaultModel,
			};
		});
}

export function reachable(provider: ProviderName): boolean {
	return Boolean(providerSpecFor(provider, providerSpecs).apiKey);
}

export function evalConcurrency(): number {
	const wanted = evalsEnv.EVAL_CONCURRENCY;
	if (evalMatrix().some((target) => target.provider === "llamacpp")) return 1;
	return wanted;
}
