import { providerSpecs } from "@repo/env/providers";
import { defineProvider, repetitionPenaltyBody } from "./core.ts";

export const digitalocean = defineProvider({
	...providerSpecs.digitalocean,
	extraBody: (opts) => ({
		reasoning_effort: opts.reasoningEffort ?? "low",
		...repetitionPenaltyBody(opts),
	}),
});
