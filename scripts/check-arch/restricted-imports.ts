import type { Check } from "./check.ts";

interface ImportRule {
	modules: string[];
	allow: string[];
	reason: string;
}

const RULES: ImportRule[] = [
	{
		modules: ["@repo/evals/global-setup", "@repo/evals/runner"],
		allow: [
			"apps/trace-viewer/evals/",
			"apps/trace-viewer/vitest.evals.config.ts",
		],
		reason:
			"Only the eval cases run a suite. Read reports through @repo/evals/report, /review and /storage instead.",
	},
	{
		modules: ["lucide-react"],
		allow: [],
		reason:
			"Icons come from @hugeicons/core-free-icons, drawn with <HugeiconsIcon icon={...} />.",
	},
];

export const restrictedImports: Check = {
	name: "restricted imports",
	rule: [
		"A file imports a module that only the places listed for it may import.",
	],
	fix: [
		"Use what the reason names instead. Widen the allow list in",
		"scripts/check-arch/restricted-imports.ts only if the module's owner moved.",
	],
	run: (tree) =>
		RULES.flatMap((rule) =>
			tree.sources
				.filter((file) => !rule.allow.some((prefix) => file.startsWith(prefix)))
				.flatMap((file) =>
					rule.modules
						.filter((module) => tree.read(file).includes(`"${module}"`))
						.map((module) => ({
							file,
							what: `imports ${module}`,
							why: rule.reason,
						})),
				),
		),
};
