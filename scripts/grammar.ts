import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CLI_VERSION = "0.25.10";
export const EMCC_VERSION = "4.0.12-git";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export const GRAMMAR_DIR = join(root, "tree-sitter-lisptc");
export const GRAMMAR = join(GRAMMAR_DIR, "grammar.js");
export const WASM = join(root, "packages", "syntax", "src", "lisptc.wasm");
export const STAMP = `${WASM}.json`;

export interface Stamp {
	grammar: string;
	cli: string;
	emcc: string;
}

export function grammarDigest(): string {
	return createHash("sha256").update(readFileSync(GRAMMAR)).digest("hex");
}

export function relative(path: string): string {
	return path.slice(root.length + 1);
}
