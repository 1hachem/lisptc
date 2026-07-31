import { readFileSync } from "node:fs";

// The interpreter's own source files, read at import time. These are embedded
// into the agent's system prompt so the LLM knows the exact language it is
// programming — the source is the authoritative definition of the dialect.
const FILES = [
	"arith.ts",
	"lisp.ts",
	"repl.ts",
	"cli.ts",
	"grammar.ts",
	"mcp.ts",
	"mcp-broker.ts",
	"lisptc.gbnf",
] as const;

function read(file: string): string {
	return readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
}

function lang(file: string): string {
	if (file.endsWith(".ts")) return "typescript";
	if (file.endsWith(".gbnf")) return "gbnf";
	return "";
}

// Every interpreter source file, keyed by its `src/`-relative path.
export const INTERPRETER_SOURCES: Record<string, string> = Object.fromEntries(
	FILES.map((file) => [file, read(file)]),
);

// All interpreter source files formatted as one markdown document, each under
// a `### src/<file>` heading with a fenced code block. Ready to embed into a
// system prompt.
export const INTERPRETER_SOURCE: string = FILES.map(
	(file) =>
		`### src/${file}\n\`\`\`${lang(file)}\n${INTERPRETER_SOURCES[file]}\n\`\`\``,
).join("\n\n");
