import { existsSync, readFileSync } from "node:fs";
import {
	CLI_VERSION,
	GRAMMAR,
	grammarDigest,
	relative,
	STAMP,
	type Stamp,
	WASM,
} from "./grammar.ts";

function stale(reason: string): never {
	console.error(reason);
	console.error("");
	console.error(
		"The chat highlights lisp with this wasm, built from the grammar that",
	);
	console.error(
		"ptcfmt reads. Rebuild it with `pnpm build:grammar` (needs docker), then",
	);
	console.error("commit the wasm and its stamp together.");
	process.exit(1);
}

if (!existsSync(WASM)) stale(`${relative(WASM)} is missing.`);
if (!existsSync(STAMP)) stale(`${relative(STAMP)} is missing.`);

const stamp = JSON.parse(readFileSync(STAMP, "utf8")) as Stamp;

if (stamp.grammar !== grammarDigest())
	stale(`${relative(GRAMMAR)} has changed since ${relative(WASM)} was built.`);

if (stamp.cli !== CLI_VERSION)
	stale(
		`${relative(WASM)} was built by tree-sitter-cli ${stamp.cli}, and the build now pins ${CLI_VERSION}.`,
	);

console.log(`Grammar wasm matches ${relative(GRAMMAR)}.`);
