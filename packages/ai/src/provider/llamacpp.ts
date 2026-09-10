import { providerSpecs } from "@repo/env/providers";
import { DEFAULT_REPEAT_PENALTY, defineProvider, gbnfBody } from "./core.ts";

export const llamacpp = defineProvider({
	...providerSpecs.llamacpp,
	grammarBody: gbnfBody,
	extraBody: (opts) => ({
		repeat_penalty: opts.repeatPenalty ?? DEFAULT_REPEAT_PENALTY,
		...(opts.repeatLastN !== undefined
			? { repeat_last_n: opts.repeatLastN }
			: {}),
	}),
});
