import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { carriers } from "./check-arch/carriers.ts";
import { type Check, exportedFiles, type Tree } from "./check-arch/check.ts";
import { extensionBlind } from "./check-arch/extension-blind.ts";
import { extensionHost } from "./check-arch/extension-host.ts";
import { extensionReach } from "./check-arch/extension-reach.ts";
import { manifests } from "./check-arch/manifests.ts";
import { mcpCluster } from "./check-arch/mcp-cluster.ts";
import { restrictedImports } from "./check-arch/restricted-imports.ts";
import { sessionDrivers } from "./check-arch/session-drivers.ts";
import { sniffers } from "./check-arch/sniffers.ts";

type Field = "dependencies" | "devDependencies" | "peerDependencies";

type Manifest = Partial<Record<Field, Record<string, string>>>;

function manifestsTagged(tag: string): string[] {
	return execFileSync(
		"git",
		["ls-files", "packages/*/turbo.json", "apps/*/turbo.json"],
		{ encoding: "utf8" },
	)
		.split("\n")
		.filter((file) => file !== "")
		.filter((file) =>
			(
				JSON.parse(readFileSync(file, "utf8")) as { tags?: string[] }
			).tags?.includes(tag),
		)
		.map((file) => join(dirname(file), "package.json"));
}

const staticPackages: Check = {
	name: "static packages",
	rule: [
		"A package tagged static is data. It depends on a foundation package",
		"at most, and builds on no workspace package outside the foundation.",
	],
	fix: ["Drop the dependency, or move the code that needs it out of the data."],
	run: () => {
		const foundation = new Set(
			manifestsTagged("foundation").map(
				(manifest) =>
					(JSON.parse(readFileSync(manifest, "utf8")) as { name: string }).name,
			),
		);
		return manifestsTagged("static").flatMap((file) => {
			const manifest = JSON.parse(readFileSync(file, "utf8")) as Manifest;
			const forbidden: [Field, (name: string) => boolean][] = [
				["dependencies", (name) => !foundation.has(name)],
				["peerDependencies", (name) => !foundation.has(name)],
				[
					"devDependencies",
					(name) => name.startsWith("@repo/") && !foundation.has(name),
				],
			];
			return forbidden.flatMap(([field, isForbidden]) =>
				Object.keys(manifest[field] ?? {})
					.filter(isForbidden)
					.map((name) => ({ file, what: `lists ${name} in ${field}` })),
			);
		});
	},
};

function importedNames(text: string): Set<string> {
	const names = new Set<string>();
	const re = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+"[^"]+"/g;
	for (let m = re.exec(text); m !== null; m = re.exec(text))
		for (const part of m[1].replace(/[{}]/g, ",").split(",")) {
			const name = part
				.trim()
				.replace(/^type\s+/, "")
				.split(/\s+as\s+/)
				.pop()
				?.replace(/^\*\s*/, "")
				.trim();
			if (name) names.add(name);
		}
	return names;
}

function relaysIn(text: string, entry: boolean): string[] {
	const found: string[] = [];
	for (const m of text.matchAll(
		/^export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s+"([^"]+)"/gm,
	))
		if (!entry || !m[1].startsWith(".")) found.push(`re-exports from ${m[1]}`);
	const imported = importedNames(text);
	for (const m of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}\s*;/gm))
		for (const part of m[1].split(",")) {
			const name = part
				.trim()
				.replace(/^type\s+/, "")
				.split(/\s+as\s+/)[0];
			if (imported.has(name)) found.push(`re-exports ${name}`);
		}
	for (const m of text.matchAll(
		/^export\s+(?:type|const)\s+(\w+)\s*=\s*(\w+)\s*;/gm,
	))
		if (imported.has(m[2])) found.push(`renames ${m[2]} to ${m[1]}`);
	return found;
}

const relays: Check = {
	name: "relayed names",
	rule: [
		"A name is exported once, by the module that declares it, and every",
		"importer names that module. Only a package's root entrypoint gathers",
		"names, and only from its own files.",
	],
	fix: [
		"Import it from where it is declared, and add a package.json export for",
		"that module if it has none.",
	],
	run: (tree) => {
		const entrypoints = new Set(
			[...tree.exported]
				.filter(
					([name]) => name.split("/").length === (name.startsWith("@") ? 2 : 1),
				)
				.map(([, file]) => file),
		);
		return tree.sources.flatMap((file) =>
			relaysIn(tree.read(file), entrypoints.has(file)).map((what) => ({
				file,
				what,
			})),
		);
	},
};

const CHECKS: Check[] = [
	manifests,
	staticPackages,
	restrictedImports,
	mcpCluster,
	extensionReach,
	extensionHost,
	sessionDrivers,
	extensionBlind,
	carriers,
	sniffers,
	relays,
];

const self = relative(process.cwd(), fileURLToPath(import.meta.url));

const sources = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], {
	encoding: "utf8",
})
	.split("\n")
	.filter(
		(file) =>
			file !== "" &&
			file !== self &&
			!file.startsWith("scripts/check-arch/") &&
			existsSync(file),
	);

const texts = new Map<string, string>();

const tree: Tree = {
	sources,
	exported: exportedFiles(),
	read: (file) => {
		const known = texts.get(file);
		if (known !== undefined) return known;
		const text = readFileSync(file, "utf8");
		texts.set(file, text);
		return text;
	},
};

function many(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const failed = CHECKS.map((check) => ({
	check,
	violations: check.run(tree),
})).filter(({ violations }) => violations.length > 0);

if (failed.length === 0) {
	console.log(
		`No architecture violations: ${many(CHECKS.length, "check")} passed over ${many(sources.length, "source")}.`,
	);
	process.exit(0);
}

for (const { check, violations } of failed) {
	console.error(`✗ ${check.name}: ${many(violations.length, "violation")}`);
	for (const line of check.rule) console.error(`  ${line}`);
	console.error("");
	for (const { file, what, why } of violations) {
		console.error(`  ${file} ${what}`);
		if (why) console.error(`    ${why}`);
	}
	console.error("");
	console.error("  Way out:");
	for (const line of check.fix) console.error(`    ${line}`);
	console.error("");
}

const total = failed.reduce(
	(sum, { violations }) => sum + violations.length,
	0,
);
console.error(
	`${many(total, "violation")} in ${many(failed.length, "check")} of ${CHECKS.length}: ${failed.map(({ check }) => check.name).join(", ")}.`,
);
process.exit(1);
