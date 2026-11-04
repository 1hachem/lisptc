import { filePrompt } from "@repo/shared/host-node";
import { MemoryPreferencesStore, type PreferencesHost } from "./ports.ts";

const preferencesPrompt = filePrompt(
	new URL("./preferences.ptc", import.meta.url),
);

const preferencesMemories = filePrompt(
	new URL("./preferences.memories.ptc", import.meta.url),
);

export function preferencesHostFor(
	options: Partial<Omit<PreferencesHost, "prompt" | "memories">> = {},
): PreferencesHost {
	return {
		store: options.store ?? new MemoryPreferencesStore(),
		fonts: options.fonts ?? [],
		motions: options.motions ?? [],
		...(options.desktop === undefined ? {} : { desktop: options.desktop }),
		prompt: preferencesPrompt,
		memories: preferencesMemories,
	};
}

export const preferencesHost: PreferencesHost = preferencesHostFor();
