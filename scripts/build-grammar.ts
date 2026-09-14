import { execFileSync } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	CLI_VERSION,
	EMCC_VERSION,
	GRAMMAR_DIR,
	grammarDigest,
	relative,
	STAMP,
	type Stamp,
	WASM,
} from "./grammar.ts";

function missing(tool: string): never {
	console.error(`${tool} is not on PATH.`);
	console.error("");
	console.error("The grammar builds with the toolchain the flake pins:");
	console.error("");
	console.error("  nix develop -c pnpm build:grammar");
	process.exit(1);
}

function wrongVersion(tool: string, found: string, pinned: string): never {
	console.error(`${tool} ${found} is on PATH, and the build pins ${pinned}.`);
	console.error("");
	console.error(
		"Build inside `nix develop`, or follow the flake by bumping the pin in",
	);
	console.error("scripts/grammar.ts and rebuilding.");
	process.exit(1);
}

const VERSION = /\b\d+\.\d+\.\d+\S*/;

function versionOf(tool: string): string {
	try {
		const out = execFileSync(tool, ["--version"], { encoding: "utf8" });
		return out.split("\n")[0].match(VERSION)?.[0] ?? "";
	} catch {
		missing(tool);
	}
}

const cli = versionOf("tree-sitter");
if (cli !== CLI_VERSION) wrongVersion("tree-sitter", cli, CLI_VERSION);

const emcc = versionOf("emcc");
if (emcc !== EMCC_VERSION) wrongVersion("emcc", emcc, EMCC_VERSION);

const run = (args: string[]) =>
	execFileSync("tree-sitter", args, { cwd: GRAMMAR_DIR, stdio: "inherit" });

run(["generate"]);
run(["build", "--wasm", "."]);
renameSync(join(GRAMMAR_DIR, "tree-sitter-lisptc.wasm"), WASM);

const stamp: Stamp = { grammar: grammarDigest(), cli, emcc };
writeFileSync(STAMP, `${JSON.stringify(stamp, null, 2)}\n`);

console.log(`Wrote ${relative(WASM)} and ${relative(STAMP)}.`);
