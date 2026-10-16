import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Violation {
	file: string;
	what: string;
	why?: string;
}

export interface Check {
	name: string;
	rule: string[];
	fix: string[];
	run(tree: Tree): Violation[];
}

export interface Tree {
	sources: string[];
	read(file: string): string;
	exported: Map<string, string>;
}

const EXTENSION_DIRS = [
	"packages/compaction/src/",
	"packages/diagnostics/src/",
	"packages/introspection/src/",
	"packages/memory/src/",
	"packages/permissions/src/",
	"packages/preferences/src/",
	"packages/promises/src/",
	"packages/prose/src/",
	"packages/secrets/src/",
	"packages/ui-extension/src/",
	"packages/workspace/src/",
];

const EXTENSION_FILES = [
	"packages/llm/src/llm.ts",
	"packages/mcp/src/mcp.ts",
	"packages/mcp/src/ports.ts",
];

export function isExtensionModule(file: string): boolean {
	if (file.endsWith("-host.ts")) return false;
	if (EXTENSION_FILES.includes(file)) return true;
	return EXTENSION_DIRS.some((dir) => file.startsWith(dir));
}

function names(clause: string): string[] {
	return clause
		.replace(/[{}]/g, " ")
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part !== "")
		.map((part) => part.split(/\s+as\s+/)[0].trim());
}

export interface Import {
	module: string;
	names: string[];
	typeOnly: boolean;
}

export function imports(text: string): Import[] {
	const re = /import\s+(type\s+)?([\s\S]*?)from\s+"([^"]+)"/g;
	return [...text.matchAll(re)].map((found) => ({
		module: found[3],
		typeOnly: found[1] !== undefined,
		names: names(found[2]),
	}));
}

export function runtimeImports(text: string): Import[] {
	return imports(text)
		.filter((found) => !found.typeOnly)
		.map((found) => ({
			...found,
			names: found.names.filter((name) => !name.startsWith("type ")),
		}));
}

export function modulesOf(text: string): string[] {
	return [...text.matchAll(/from\s+"([^"]+)"/g)].map((found) => found[1]);
}

export function resolved(tree: Tree, file: string, module: string): string {
	if (module.startsWith(".")) return join(dirname(file), module);
	return tree.exported.get(module) ?? "";
}

export function exportedFiles(): Map<string, string> {
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
