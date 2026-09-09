import { providerSpecs } from "@repo/shared/providers";
import { defineProvider, repetitionPenaltyBody } from "./core.ts";

export const digitalocean = defineProvider({
	...providerSpecs.digitalocean,
	extraBody: repetitionPenaltyBody,
	grammarBody: null,
});
