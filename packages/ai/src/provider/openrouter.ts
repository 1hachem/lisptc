import { providerSpecs } from "@repo/shared/providers";
import { defineProvider, repetitionPenaltyBody } from "./core.ts";

export const openrouter = defineProvider({
	...providerSpecs.openrouter,
	extraBody: repetitionPenaltyBody,
	grammarBody: null,
});
