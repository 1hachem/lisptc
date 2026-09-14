import { execFileSync } from "node:child_process";
import { renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const grammar = join(root, "tree-sitter-lisptc");
const target = join(root, "packages", "syntax", "src", "lisptc.wasm");

const cli = ["--yes", "tree-sitter-cli@0.25.10"];
const run = (args: string[], cwd: string) =>
	execFileSync("npx", [...cli, ...args], { cwd, stdio: "inherit" });

run(["generate"], grammar);
run(["build", "--wasm", "--docker", "."], grammar);
renameSync(join(grammar, "tree-sitter-lisptc.wasm"), target);
console.log(`wrote ${target}`);
