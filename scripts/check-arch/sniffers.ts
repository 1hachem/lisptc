import type { Check } from "./check.ts";

const SNIFFER = /export function (\w+)\([^)]*: InterpExtension[,)]/g;

export const sniffers: Check = {
	name: "capability dug out of an extension",
	rule: [
		"A function takes an extension and digs a field out of it. Nobody",
		"searches the extension list for a capability.",
	],
	fix: [
		"Have the extension hand the capability over with hooks.fill(slot, value),",
		"and read it with hooks.filled(slot).",
	],
	run: (tree) =>
		tree.sources.flatMap((file) =>
			[...tree.read(file).matchAll(SNIFFER)].map((found) => ({
				file,
				what: `exports ${found[1]}`,
			})),
		),
};
