import { type Check, isExtensionModule, runtimeImports } from "./check.ts";

const REACHES: { pattern: RegExp; what: string }[] = [
	{ pattern: /^node:/, what: "a node builtin" },
	{ pattern: /^@repo\/env\//, what: "a typed env module" },
	{ pattern: /^@modelcontextprotocol\/sdk/, what: "the MCP SDK" },
	{ pattern: /^@langchain\//, what: "a langchain package" },
	{ pattern: /^dotenv$/, what: "dotenv" },
];

const GLOBALS = /\bprocess\.(env|cwd|platform|kill)\b/;

function hostOf(file: string): string {
	return file.replace(/\.ts$/, "-host.ts");
}

export const extensionReach: Check = {
	name: "extension reaches the world",
	rule: [
		"An extension module touches the filesystem, the environment, the",
		"network, an SDK or a process global itself. An extension only declares",
		"the ports it needs, so it runs the same wherever it is composed.",
	],
	fix: [
		"Declare a port in the extension, implement it in the colocated -host.ts",
		"named under each violation, and let a composition root pass it in.",
	],
	run: (tree) =>
		tree.sources.filter(isExtensionModule).flatMap((file) => {
			const text = tree.read(file);
			const found = runtimeImports(text).flatMap(({ module }) =>
				REACHES.filter(({ pattern }) => pattern.test(module)).map(
					({ what }) => `imports ${what} (${module})`,
				),
			);
			const global = GLOBALS.exec(text);
			if (global) found.push(`reads ${global[0]}`);
			return found.map((what) => ({
				file,
				what,
				why: `Move it to ${hostOf(file)}.`,
			}));
		}),
};
