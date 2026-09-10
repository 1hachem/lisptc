import { providerSpecs } from "@repo/env/providers";
import { defineProvider, repetitionPenaltyBody } from "./core.ts";

export const fireworks = defineProvider({
	...providerSpecs.fireworks,
	extraBody: (opts) => ({
		reasoning_effort: opts.reasoningEffort ?? "low",
		...repetitionPenaltyBody(opts),
	}),
});
