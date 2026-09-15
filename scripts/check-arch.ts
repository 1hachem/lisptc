import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

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

interface ImportRule {
	modules: string[];
	allow: string[];
	reason: string;
}

const IMPORTS: ImportRule[] = [
	{
		modules: [
			"@repo/evals/global-setup",
			"@repo/evals/harness",
			"@repo/evals/judge",
			"@repo/evals/runner",
			"@repo/evals/targets",
		],
		allow: [
			"apps/trace-viewer/evals/",
			"apps/trace-viewer/vitest.evals.config.ts",
		],
		reason:
			"Only the eval cases run a suite. Read reports through @repo/evals/report, /review and /storage instead.",
	},
];

const EXTENSION_DIRS = ["packages/interpreter/src/extensions/"];

const EXTENSION_FILES = [
	"packages/llm/src/llm.ts",
	"packages/mcp/src/mcp.ts",
	"packages/mcp/src/ports.ts",
];

const HOST_REACHES: { pattern: RegExp; what: string }[] = [
	{ pattern: /^node:/, what: "a node builtin" },
	{ pattern: /^@repo\/env\//, what: "a typed env module" },
	{ pattern: /^@modelcontextprotocol\/sdk/, what: "the MCP SDK" },
	{ pattern: /^@langchain\//, what: "a langchain package" },
	{ pattern: /^dotenv$/, what: "dotenv" },
];

const HOST_GLOBALS = /\bprocess\.(env|cwd|platform|kill)\b/;

function isExtensionModule(file: string): boolean {
	if (file.endsWith("-host.ts")) return false;
	if (EXTENSION_FILES.includes(file)) return true;
	return EXTENSION_DIRS.some((dir) => file.startsWith(dir));
}

function runtimeImports(text: string): string[] {
	const out: string[] = [];
	const re = /import\s+(type\s+)?([\s\S]*?)from\s+"([^"]+)"/g;
	for (let m = re.exec(text); m !== null; m = re.exec(text))
		if (m[1] === undefined) out.push(m[3]);
	return out;
}

function hostReaches(text: string): string[] {
	const found: string[] = [];
	for (const specifier of runtimeImports(text))
		for (const { pattern, what } of HOST_REACHES)
			if (pattern.test(specifier)) found.push(`imports ${what} (${specifier})`);
	const global = HOST_GLOBALS.exec(text);
	if (global) found.push(`reads ${global[0]}`);
	return found;
}

type Manifest = Partial<Record<Field, Record<string, string>>>;

const offenders = RULES.flatMap((rule) => {
	const manifest = JSON.parse(readFileSync(rule.manifest, "utf8")) as Manifest;
	return rule.fields.flatMap((field) =>
		Object.keys(manifest[field] ?? {})
			.filter(rule.forbidden)
			.map((name) => ({ rule, field, name })),
	);
});

const self = relative(process.cwd(), fileURLToPath(import.meta.url));

const sources = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], {
	encoding: "utf8",
})
	.split("\n")
	.filter((file) => file !== "" && file !== self && existsSync(file));

const reaches = IMPORTS.flatMap((rule) =>
	sources
		.filter((file) => !rule.allow.some((prefix) => file.startsWith(prefix)))
		.flatMap((file) => {
			const text = readFileSync(file, "utf8");
			return rule.modules
				.filter((module) => text.includes(`"${module}"`))
				.map((module) => ({ rule, file, module }));
		}),
);

const extensionModules = sources.filter(isExtensionModule);

const hosted = extensionModules.flatMap((file) =>
	hostReaches(readFileSync(file, "utf8")).map((what) => ({ file, what })),
);

if (offenders.length === 0 && reaches.length === 0 && hosted.length === 0) {
	console.log(
		`No architecture violations in ${RULES.length} manifests, ${sources.length} sources and ${extensionModules.length} extension modules.`,
	);
	process.exit(0);
}

for (const { rule, field, name } of offenders) {
	console.error(`${rule.manifest} ${field}.${name}`);
	console.error(`  ${rule.reason}`);
}

for (const { rule, file, module } of reaches) {
	console.error(`${file} imports ${module}`);
	console.error(`  ${rule.reason}`);
}

for (const { file, what } of hosted) {
	console.error(`${file} ${what}`);
	console.error(
		"  An extension defines the interface; the host lives in its colocated",
	);
	console.error(
		`  -host.ts and arrives as the default argument. Move it to ${file.replace(/\.ts$/, "-host.ts")}.`,
	);
}
console.error("");
const total = offenders.length + reaches.length + hosted.length;
console.error(`${total} forbidden dependenc${total === 1 ? "y" : "ies"}.`);
console.error("");
console.error("`turbo boundaries` holds the layer direction; these are the");
console.error("manifest rules it cannot express, because the root package's");
console.error("@repo/env devDependency puts @repo/env and @repo/shared in");
console.error("every package's turbo dependency graph. Drop the dependency,");
console.error("or change RULES in scripts/check-arch.ts if the architecture");
console.error("really moved.");
process.exit(1);
