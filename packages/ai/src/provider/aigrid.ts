import { providerSpecs } from "@repo/shared/providers";
import { defineProvider, repetitionPenaltyBody } from "./core.ts";

export const aigrid = defineProvider({
	...providerSpecs.aigrid,
	extraBody: repetitionPenaltyBody,
});
