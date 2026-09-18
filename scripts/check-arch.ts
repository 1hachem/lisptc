import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
	{
		modules: ["lucide-react"],
		allow: [],
		reason:
			"Icons come from @hugeicons/core-free-icons, drawn with <HugeiconsIcon icon={...} />.",
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

interface DriverRule {
	file: string;
	carried: string[];
}

const DRIVERS: DriverRule[] = [
	{
		file: "packages/repl/src/repl.ts",
		carried: ["joinMessages", "sent"],
	},
];

interface BlindRule {
	dir: string;
	roster: string[];
}

const BLIND: BlindRule[] = [
	{ dir: "packages/ai/src/", roster: ["packages/ai/src/repl-store.ts"] },
];

const CARRIERS = ["apps/api/src/"];

const SNIFFER = /export function (\w+)\([^)]*: InterpExtension[,)]/g;

function isExtensionModule(file: string): boolean {
	if (file.endsWith("-host.ts")) return false;
	if (EXTENSION_FILES.includes(file)) return true;
	return EXTENSION_DIRS.some((dir) => file.startsWith(dir));
}

function valueNames(clause: string): string[] {
	return clause
		.replace(/[{}]/g, " ")
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part !== "" && !part.startsWith("type "))
		.map((part) => part.split(/\s+as\s+/)[0].trim());
}

interface Import {
	module: string;
	names: string[];
}

function runtimeImports(text: string): Import[] {
	const out: Import[] = [];
	const re = /import\s+(type\s+)?([\s\S]*?)from\s+"([^"]+)"/g;
	for (let m = re.exec(text); m !== null; m = re.exec(text))
		if (m[1] === undefined) out.push({ module: m[3], names: valueNames(m[2]) });
	return out;
}

function exportedFiles(): Map<string, string> {
	const out = new Map<string, string>();
	const manifests = execFileSync(
		"git",
		["ls-files", "packages/*/package.json", "apps/*/package.json"],
		{ encoding: "utf8" },
	)
		.split("\n")
		.filter((file) => file !== "");
	for (const manifest of manifests) {
		const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
			name?: string;
			exports?: Record<string, unknown>;
		};
		if (pkg.name === undefined) continue;
		for (const [subpath, target] of Object.entries(pkg.exports ?? {}))
			if (typeof target === "string")
				out.set(
					subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`,
					join(dirname(manifest), target),
				);
	}
	return out;
}

function hostReaches(text: string): string[] {
	const found: string[] = [];
	for (const { module } of runtimeImports(text))
		for (const { pattern, what } of HOST_REACHES)
			if (pattern.test(module)) found.push(`imports ${what} (${module})`);
	const global = HOST_GLOBALS.exec(text);
	if (global) found.push(`reads ${global[0]}`);
	return found;
}

function many(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
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

const exported = exportedFiles();

const drifted = DRIVERS.flatMap(({ file, carried }) => {
	const crossings = runtimeImports(readFileSync(file, "utf8"))
		.filter(({ module }) => isExtensionModule(exported.get(module) ?? ""))
		.flatMap(({ module, names }) => names.map((name) => ({ module, name })));
	return [
		...crossings
			.filter(({ name }) => !carried.includes(name))
			.map(({ module, name }) => ({
				file,
				what: `imports ${name} from ${module}`,
			})),
		...carried
			.filter((name) => !crossings.some((crossed) => crossed.name === name))
			.map((name) => ({ file, what: `no longer imports ${name}` })),
	];
});

const blinded = BLIND.flatMap(({ dir, roster }) =>
	sources
		.filter((file) => file.startsWith(dir) && !roster.includes(file))
		.flatMap((file) =>
			[...readFileSync(file, "utf8").matchAll(/from\s+"([^"]+)"/g)]
				.map((found) => found[1])
				.filter((module) => isExtensionModule(exported.get(module) ?? ""))
				.map((module) => ({ file, module })),
		),
);

const interpreting = CARRIERS.flatMap((dir) =>
	sources
		.filter((file) => file.startsWith(dir))
		.flatMap((file) =>
			runtimeImports(readFileSync(file, "utf8"))
				.filter(({ module }) => isExtensionModule(exported.get(module) ?? ""))
				.map(({ module }) => ({ file, module })),
		),
);

const sniffers = sources.flatMap((file) =>
	[...readFileSync(file, "utf8").matchAll(SNIFFER)].map((found) => ({
		file,
		name: found[1],
	})),
);

if (
	offenders.length === 0 &&
	reaches.length === 0 &&
	hosted.length === 0 &&
	drifted.length === 0 &&
	blinded.length === 0 &&
	interpreting.length === 0 &&
	sniffers.length === 0
) {
	console.log(
		`No architecture violations in ${RULES.length} manifests, ${sources.length} sources, ${extensionModules.length} extension modules, ${many(DRIVERS.length, "session driver")}, ${many(BLIND.length, "extension-blind tree")} and ${many(CARRIERS.length, "carrier tree")}.`,
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

for (const { file, what } of drifted) {
	console.error(`${file} ${what}`);
	console.error(
		"  A session driver runs the lifecycle for extensions it cannot name.",
	);
	console.error(
		"  Declare a session hook in the extension, or a slot for the capability,",
	);
	console.error(
		"  and import the module for types only. DRIVERS in scripts/check-arch.ts",
	);
	console.error("  lists what each driver still carries.");
}

for (const { file, module } of blinded) {
	console.error(`${file} imports ${module}`);
	console.error(
		"  The agent loop runs whatever extensions the repl was built with and",
	);
	console.error(
		"  names none of them, types included. Take what the step reports through",
	);
	console.error(
		"  its annotations, ask the repl, or move the contract out of the",
	);
	console.error("  extension module.");
}

for (const { file, module } of interpreting) {
	console.error(`${file} runs ${module}`);
	console.error(
		"  A carrier builds a turn and writes what comes back. What reads or",
	);
	console.error(
		"  writes an extension's own shape belongs below the seam, in that",
	);
	console.error(
		"  extension's -host.ts, and the carrier is handed the result. Import the",
	);
	console.error("  extension for types only.");
}

for (const { file, name } of sniffers) {
	console.error(
		`${file} exports ${name}, which digs a capability out of an extension`,
	);
	console.error(
		"  An extension hands its capability over with hooks.fill(slot, value),",
	);
	console.error(
		"  and the consumer reads it with hooks.filled(slot). Nobody searches",
	);
	console.error("  the extension list.");
}

console.error("");
const total =
	offenders.length +
	reaches.length +
	hosted.length +
	drifted.length +
	blinded.length +
	interpreting.length +
	sniffers.length;
console.error(`${total} forbidden dependenc${total === 1 ? "y" : "ies"}.`);
console.error("");
console.error("`turbo boundaries` holds the layer direction; these are the");
console.error("manifest rules it cannot express, because the root package's");
console.error("@repo/env devDependency puts @repo/env and @repo/shared in");
console.error("every package's turbo dependency graph. Drop the dependency,");
console.error("or change RULES in scripts/check-arch.ts if the architecture");
console.error("really moved.");
process.exit(1);
