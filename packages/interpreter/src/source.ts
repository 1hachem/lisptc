import { readFileSync } from "node:fs";

// A distilled, human-written reference for the Lisptc dialect (syntax, data types,
// every built-in and prelude function, MCP/async/secret built-ins). Embedded into
// the agent's system prompt in place of the full interpreter source: it is ~10x
// smaller yet covers everything the model needs to WRITE code. Keep it in sync
// with the interpreter when the language changes.
export const LANGUAGE_REFERENCE: string = readFileSync(
	new URL("./SKILL.md", import.meta.url),
	"utf8",
);

// The interpreter's own source files, read at import time. These are embedded
// into the agent's system prompt so the LLM knows the exact language it is
// programming — the source is the authoritative definition of the dialect.
const FILES = [
	"arith.ts",
	"lisp.ts",
	"grammar.ts",
	"secrets.ts",
	"jobs.ts",
	"jobs-protocol.ts",
	"jobs-broker.ts",
	"mcp.ts",
	"mcp-broker.ts",
	"mcp-oauth.ts",
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
		`Here is the source code of the interpreter:
        ### src/${file}\n\`\`\`${lang(file)}\n${INTERPRETER_SOURCES[file]}\n\`\`\``,
).join("\n\n");
