import { type Check, isExtensionModule, modulesOf, resolved } from "./check.ts";

export const extensionHost: Check = {
	name: "extension names its host",
	rule: [
		"An extension module imports a -host.ts implementation. An extension",
		"declares its host interface and is handed one, so it never names the",
		"implementation, not even as a default argument to fall back on.",
	],
	fix: [
		"Take the host as a parameter and let a composition root pass it.",
		"What the host needs but does not depend on belongs in the package's",
		"ports.ts, which both sides import.",
	],
	run: (tree) =>
		tree.sources.filter(isExtensionModule).flatMap((file) =>
			modulesOf(tree.read(file))
				.filter((module) => resolved(tree, file, module).endsWith("-host.ts"))
				.map((module) => ({ file, what: `imports ${module}` })),
		),
};
