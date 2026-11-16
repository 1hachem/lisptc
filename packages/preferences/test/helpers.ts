import { Interp, runAsync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import type { DesktopPreferences } from "@repo/shared/desktop";
import {
	type DesktopPreferencesPort,
	MemoryPreferencesStore,
	type Preferences,
} from "../src/ports.ts";
import { preferencesExtension } from "../src/preferences.ts";
import { preferencesHostFor } from "../src/preferences-host.ts";

export function desktopMachine(
	connected: () => boolean,
): DesktopPreferencesPort & { held: DesktopPreferences } {
	const held: DesktopPreferences = { closeToTray: true, openAtLogin: false };
	return {
		held,
		apply: async (change) => {
			if (!connected()) return undefined;
			Object.assign(held, change);
			return { ...held };
		},
	};
}

export interface World {
	ev(code: string): Promise<string>;
	store: MemoryPreferencesStore;
}

export const HOST_CHOICES = {
	fonts: [{ id: "geist", name: "Geist" }],
	motions: [
		{ id: "slide", name: "rows slide" },
		{ id: "lift", name: "the row lifts" },
	],
	metadata: [
		{ id: "input", name: "input tokens" },
		{ id: "model", name: "model" },
	],
	input: [{ id: "lisp", name: "lisp" }],
};

export async function world(
	held: Preferences = {},
	desktop?: DesktopPreferencesPort,
): Promise<World> {
	const store = new MemoryPreferencesStore(held);
	const interp = new Interp({
		extensions: [
			preferencesExtension(
				preferencesHostFor({
					store,
					...HOST_CHOICES,
					...(desktop === undefined ? {} : { desktop }),
				}),
			),
		],
	});
	await runAsync(interp, prelude);
	return {
		store,
		ev: async (code) => str((await runAsync(interp, code)).value),
	};
}
