import { providerSpecs } from "@repo/env/providers";
import { defineProvider, providerShapes } from "./core.ts";

export const openrouter = defineProvider({
	...providerSpecs.openrouter,
	...providerShapes.openrouter,
});
