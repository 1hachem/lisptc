import { Interp, runAsync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { MemoryPreferencesStore, type Preferences } from "../src/ports.ts";
import { preferencesExtension } from "../src/preferences.ts";
import { preferencesHostFor } from "../src/preferences-host.ts";

export interface World {
	ev(code: string): Promise<string>;
	store: MemoryPreferencesStore;
}

export async function world(held: Preferences = {}): Promise<World> {
	const store = new MemoryPreferencesStore(held);
	const interp = new Interp({
		extensions: [
			preferencesExtension(
				preferencesHostFor({
					store,
					themes: [
						{
							id: "gruvbox-dark",
							name: "gruvbox dark",
							family: "gruvbox",
							scheme: "dark",
						},
						{
							id: "gruvbox-light",
							name: "gruvbox light",
							family: "gruvbox",
							scheme: "light",
						},
						{
							id: "tokyonight-dark",
							name: "tokyonight dark",
							family: "tokyonight",
							scheme: "dark",
						},
						{
							id: "tokyonight-light",
							name: "tokyonight light",
							family: "tokyonight",
							scheme: "light",
						},
						{
							id: "paper",
							name: "paper light",
							family: "paper",
							scheme: "light",
						},
					],
					defaultDarkTheme: "gruvbox-dark",
					fonts: [{ id: "geist", name: "Geist" }],
					motions: [
						{ id: "slide", name: "rows slide" },
						{ id: "lift", name: "the row lifts" },
					],
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
