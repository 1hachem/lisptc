import { type Check, isExtensionModule, modulesOf } from "./check.ts";

interface BlindRule {
	dir: string;
	roster: string[];
}

const BLIND: BlindRule[] = [
	{ dir: "packages/ai/src/", roster: [] },
	{ dir: "packages/repl/src/", roster: ["packages/repl/src/repl.ts"] },
];

export const extensionBlind: Check = {
	name: "extension-blind tree names an extension",
	rule: [
		"A file in the agent loop or the REPL layer imports an extension module,",
		"types included. Those layers run whatever extensions the REPL was built",
		"with and name none of them.",
	],
	fix: [
		"Take what the step reports through its annotations, ask the REPL, or",
		"move the contract out of the extension module.",
	],
	run: (tree) =>
		BLIND.flatMap(({ dir, roster }) =>
			tree.sources
				.filter((file) => file.startsWith(dir) && !roster.includes(file))
				.flatMap((file) =>
					modulesOf(tree.read(file))
						.filter((module) =>
							isExtensionModule(tree.exported.get(module) ?? ""),
						)
						.map((module) => ({ file, what: `imports ${module}` })),
				),
		),
};
