import { filePrompt } from "@repo/shared/host-node";
import { MemoryPreferencesStore, type PreferencesHost } from "./ports.ts";

const preferencesPrompt = filePrompt(
	new URL("./preferences.ptc", import.meta.url),
);

export function preferencesHostFor(
	options: Partial<Omit<PreferencesHost, "prompt">> = {},
): PreferencesHost {
	return {
		store: options.store ?? new MemoryPreferencesStore(),
		fonts: options.fonts ?? [],
		motions: options.motions ?? [],
		prompt: preferencesPrompt,
	};
}

export const preferencesHost: PreferencesHost = preferencesHostFor();
