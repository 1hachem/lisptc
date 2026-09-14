import { readFileSync } from "node:fs";

type Field = "dependencies" | "devDependencies" | "peerDependencies";

type Rule = {
	manifest: string;
	fields: Field[];
	forbidden: (name: string) => boolean;
	reason: string;
};

const RULES: Rule[] = [
	{
		manifest: "packages/shared/package.json",
		fields: ["dependencies", "peerDependencies"],
		forbidden: () => true,
		reason: "@repo/shared is the no-dependency utility layer.",
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
			"@repo/mcp and @repo/llm carry those SDKs so the interpreter does not.",
	},
];

type Manifest = Partial<Record<Field, Record<string, string>>>;

const offenders = RULES.flatMap((rule) => {
	const manifest = JSON.parse(readFileSync(rule.manifest, "utf8")) as Manifest;
	return rule.fields.flatMap((field) =>
		Object.keys(manifest[field] ?? {})
			.filter(rule.forbidden)
			.map((name) => ({ rule, field, name })),
	);
});

if (offenders.length === 0) {
	console.log(`No architecture violations in ${RULES.length} manifests.`);
	process.exit(0);
}

for (const { rule, field, name } of offenders) {
	console.error(`${rule.manifest} ${field}.${name}`);
	console.error(`  ${rule.reason}`);
}
console.error("");
console.error(
	`${offenders.length} forbidden dependenc${offenders.length === 1 ? "y" : "ies"}.`,
);
console.error("");
console.error("`turbo boundaries` holds the layer direction; these are the");
console.error("manifest rules it cannot express, because the root package's");
console.error("@repo/env devDependency puts @repo/env and @repo/shared in");
console.error("every package's turbo dependency graph. Drop the dependency,");
console.error("or change RULES in scripts/check-arch.ts if the architecture");
console.error("really moved.");
process.exit(1);
