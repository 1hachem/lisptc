import { evalsEnv } from "@repo/env/evals";
import { providerSpecs } from "@repo/env/providers";
import {
	type CataloguedChoice,
	choiceFrom,
	DEFAULT_CHOICE,
	type ProviderName,
	providerSpecFor,
} from "@repo/shared/providers";

export function evalMatrix(): CataloguedChoice[] {
	const raw = evalsEnv.EVAL_MATRIX;
	if (!raw) return [DEFAULT_CHOICE];
	return raw
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => choiceFrom(entry, providerSpecs));
}

export function reachable(provider: ProviderName): boolean {
	return Boolean(providerSpecFor(provider, providerSpecs).apiKey);
}

export function evalConcurrency(): number {
	return evalsEnv.EVAL_CONCURRENCY;
}
