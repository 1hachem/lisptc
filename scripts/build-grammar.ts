import { execFileSync } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	CLI_VERSION,
	GRAMMAR_DIR,
	grammarDigest,
	relative,
	type Stamp,
	STAMP,
	WASM,
} from "./grammar.ts";

const run = (args: string[]) =>
	execFileSync("npx", ["--yes", `tree-sitter-cli@${CLI_VERSION}`, ...args], {
		cwd: GRAMMAR_DIR,
		stdio: "inherit",
	});

run(["generate"]);
run(["build", "--wasm", "--docker", "."]);
renameSync(join(GRAMMAR_DIR, "tree-sitter-lisptc.wasm"), WASM);

const stamp: Stamp = { grammar: grammarDigest(), cli: CLI_VERSION };
writeFileSync(STAMP, `${JSON.stringify(stamp, null, 2)}\n`);

console.log(`Wrote ${relative(WASM)} and ${relative(STAMP)}.`);
