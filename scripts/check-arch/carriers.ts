import { type Check, isExtensionModule, runtimeImports } from "./check.ts";

const CARRIERS = ["apps/app/server/agent/"];

export const carriers: Check = {
	name: "carrier runs an extension",
	rule: [
		"A carrier imports a value from an extension module. A carrier builds a",
		"turn and writes what comes back; reading or writing an extension's own",
		"shape belongs below the seam.",
	],
	fix: [
		"Move that code into the extension's -host.ts, hand the carrier the",
		"result, and import the extension for types only.",
	],
	run: (tree) =>
		CARRIERS.flatMap((dir) =>
			tree.sources
				.filter((file) => file.startsWith(dir))
				.flatMap((file) =>
					runtimeImports(tree.read(file))
						.filter(({ module }) =>
							isExtensionModule(tree.exported.get(module) ?? ""),
						)
						.map(({ module }) => ({ file, what: `runs ${module}` })),
				),
		),
};
