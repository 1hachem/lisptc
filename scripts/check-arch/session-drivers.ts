import { type Check, isExtensionModule, runtimeImports } from "./check.ts";

interface DriverRule {
	file: string;
	carried: string[];
}

const DRIVERS: DriverRule[] = [
	{
		file: "packages/repl/src/repl.ts",
		carried: [],
	},
];

export const sessionDrivers: Check = {
	name: "session driver names an extension",
	rule: [
		"A session driver imports a value from an extension module, or no longer",
		"imports one its carried list still names. A driver runs the lifecycle",
		"for extensions it cannot name.",
	],
	fix: [
		"Declare a session hook in the extension, or a slot for the capability,",
		"and import the module for types only. When a carried import goes away,",
		"drop it from DRIVERS in scripts/check-arch/session-drivers.ts.",
	],
	run: (tree) =>
		DRIVERS.flatMap(({ file, carried }) => {
			const crossings = runtimeImports(tree.read(file))
				.filter(({ module }) =>
					isExtensionModule(tree.exported.get(module) ?? ""),
				)
				.flatMap(({ module, names }) =>
					names.map((name) => ({ module, name })),
				);
			return [
				...crossings
					.filter(({ name }) => !carried.includes(name))
					.map(({ module, name }) => ({
						file,
						what: `imports ${name} from ${module}`,
					})),
				...carried
					.filter((name) => !crossings.some((crossed) => crossed.name === name))
					.map((name) => ({
						file,
						what: `no longer imports ${name}, which DRIVERS still carries`,
					})),
			];
		}),
};
