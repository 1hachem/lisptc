import type { Check } from "./check.ts";

interface ImportRule {
	modules: string[];
	names?: string[];
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
		modules: ["@dnd-kit/core"],
		names: ["DragOverlay"],
		allow: ["packages/components/src/cursor-drag-overlay.tsx"],
		reason:
			"The page runs under CSS zoom, and a bare DragOverlay trails behind the cursor under it. Wrap the overlay in CursorDragOverlay from packages/components/src/cursor-drag-overlay.tsx.",
	},
	{
		modules: ["lucide-react"],
		allow: [],
		reason:
			"Icons come from @hugeicons/core-free-icons, drawn with <HugeiconsIcon icon={...} />.",
	},
];

function imports(source: string, module: string, names?: string[]): boolean {
	if (names === undefined) return source.includes(`"${module}"`);
	const specifiers = new RegExp(
		`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*"${module}"`,
		"g",
	);
	return [...source.matchAll(specifiers)].some(([, named]) =>
		names.some((name) => new RegExp(`\\b${name}\\b`).test(named ?? "")),
	);
}

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
						.filter((module) => imports(tree.read(file), module, rule.names))
						.map((module) => ({
							file,
							what: `imports ${rule.names?.join(", ") ?? module} from ${module}`,
							why: rule.reason,
						})),
				),
		),
};
