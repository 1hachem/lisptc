import { readFileSync } from "node:fs";
import type { Check } from "./check.ts";

type Field = "dependencies" | "devDependencies" | "peerDependencies";

type Manifest = Partial<Record<Field, Record<string, string>>>;

interface ManifestRule {
	manifest: string;
	fields: Field[];
	forbidden: (name: string) => boolean;
	reason: string;
}

const RULES: ManifestRule[] = [
	{
		manifest: "packages/shared/package.json",
		fields: ["dependencies", "peerDependencies"],
		forbidden: (name) => name !== "zod",
		reason:
			"@repo/shared is the utility layer and carries zod, the schemas its contracts are written in, and nothing else.",
	},
	{
		manifest: "packages/ui/package.json",
		fields: ["dependencies", "devDependencies", "peerDependencies"],
		forbidden: (name) =>
			name.startsWith("@repo/") && name !== "@repo/tsconfigs",
		reason:
			"@repo/ui is the base design system and depends on no other workspace package.",
	},
	{
		manifest: "packages/interpreter/package.json",
		fields: ["dependencies", "devDependencies"],
		forbidden: (name) =>
			name === "@modelcontextprotocol/sdk" || name === "@langchain/openai",
		reason:
			"@repo/mcp and @repo/llm carry those SDKs so the interpreter never does.",
	},
];

export const manifests: Check = {
	name: "manifest dependencies",
	rule: [
		"A package's manifest names a dependency its layer forbids.",
		"turbo boundaries holds the layer direction but cannot express these,",
		"because the root's @repo/env devDependency puts @repo/env and",
		"@repo/shared in every package's dependency graph.",
	],
	fix: [
		"Drop the dependency. Change RULES in scripts/check-arch/manifests.ts",
		"only if the architecture really moved.",
	],
	run: () =>
		RULES.flatMap((rule) => {
			const manifest = JSON.parse(
				readFileSync(rule.manifest, "utf8"),
			) as Manifest;
			return rule.fields.flatMap((field) =>
				Object.keys(manifest[field] ?? {})
					.filter(rule.forbidden)
					.map((name) => ({
						file: rule.manifest,
						what: `lists ${name} in ${field}`,
						why: rule.reason,
					})),
			);
		}),
};
