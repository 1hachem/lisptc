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
