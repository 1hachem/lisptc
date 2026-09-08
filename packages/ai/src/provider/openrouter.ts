import { providerSpecs } from "@repo/env/ai";
import { defineProvider, repetitionPenaltyBody } from "./core.ts";

export const openrouter = defineProvider({
	...providerSpecs.openrouter,
	extraBody: repetitionPenaltyBody,
});
