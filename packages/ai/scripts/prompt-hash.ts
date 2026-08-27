// Prints a short content hash of the lisptc system prompt. Both `serve-gemma`
// (restore) and `serve-gemma:warm` (save) name the KV cache file after this, so
// editing the prompt (or the interpreter source it embeds) changes the hash and
// the stale cache is simply never found — no manual invalidation needed.
import { createHash } from "node:crypto";
import { SYSTEM_PROMPT } from "../src/prompts/lisp.ts";

process.stdout.write(
	createHash("sha256").update(SYSTEM_PROMPT).digest("hex").slice(0, 12),
);
