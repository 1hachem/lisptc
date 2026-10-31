import { filePrompt } from "@repo/shared/host-node";
import {
	type OnboardingHost,
	type OnboardingStore,
	VolatileOnboardingStore,
} from "./ports.ts";

export function onboardingHostFor(
	store: OnboardingStore = new VolatileOnboardingStore(),
): OnboardingHost {
	return {
		store,
		prompt: filePrompt(new URL("./onboarding.ptc", import.meta.url)),
	};
}
