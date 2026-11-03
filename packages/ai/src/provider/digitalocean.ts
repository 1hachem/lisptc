import { providerSpecs } from "@repo/env/providers";
import { defineProvider, providerShapes } from "./core.ts";

export const digitalocean = defineProvider({
	...providerSpecs.digitalocean,
	...providerShapes.digitalocean,
});
