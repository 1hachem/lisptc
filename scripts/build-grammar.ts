import { execFileSync } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	CLI_VERSION,
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
	console.error("The grammar builds with the toolchain the flake pins. Run");
	console.error("`nix develop -c pnpm build:grammar`, or put tree-sitter and");
	console.error("emscripten on PATH yourself.");
	process.exit(1);
}

function cliVersion(): string {
	try {
		const out = execFileSync("tree-sitter", ["--version"], {
			encoding: "utf8",
		});
		return out.trim().split(" ")[1] ?? "";
	} catch {
		missing("tree-sitter");
	}
}

const cli = cliVersion();
if (cli !== CLI_VERSION) {
	console.error(
		`tree-sitter ${cli} is on PATH, and the build pins ${CLI_VERSION}.`,
	);
	console.error("");
	console.error("Bump CLI_VERSION in scripts/grammar.ts to follow the flake,");
	console.error("then rebuild so the wasm and its stamp agree.");
	process.exit(1);
}

try {
	execFileSync("emcc", ["--version"], { stdio: "ignore" });
} catch {
	missing("emcc");
}

const run = (args: string[]) =>
	execFileSync("tree-sitter", args, { cwd: GRAMMAR_DIR, stdio: "inherit" });

run(["generate"]);
run(["build", "--wasm", "."]);
renameSync(join(GRAMMAR_DIR, "tree-sitter-lisptc.wasm"), WASM);

const stamp: Stamp = { grammar: grammarDigest(), cli };
writeFileSync(STAMP, `${JSON.stringify(stamp, null, 2)}\n`);

console.log(`Wrote ${relative(WASM)} and ${relative(STAMP)}.`);
