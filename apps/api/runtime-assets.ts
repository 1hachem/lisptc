import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

function rootOf(entry: string): URL {
	return pathToFileURL(`${dirname(entry)}/`);
}

export const PROMPT_ROOTS = [
	rootOf(require.resolve("@repo/interpreter/source")),
	rootOf(require.resolve("@repo/mcp")),
	rootOf(require.resolve("@repo/llm/llm")),
];

function promptFiles(dir: URL): URL[] {
	return readdirSync(dir, { recursive: true, encoding: "utf8" })
		.filter((name) => name.endsWith(".ptc"))
		.map((name) => new URL(name, dir));
}

export const RUNTIME_ASSETS: URL[] = [
	...PROMPT_ROOTS.flatMap(promptFiles),
	pathToFileURL(require.resolve("@repo/mcp/mcp.toolkit.json")),
];

export function assetName(asset: URL): string {
	return asset.pathname.split("/").pop() as string;
}
