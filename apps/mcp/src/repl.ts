import { compactionExtension } from "@repo/interpreter/compaction";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { promisesExtension } from "@repo/interpreter/promises";
import { proseExtension } from "@repo/interpreter/prose";
import { secretsExtension } from "@repo/interpreter/secrets";
import { llmExtension } from "@repo/llm/llm";
import { mcpExtension } from "@repo/mcp";
import { MemoryRepl } from "@repo/repl/repl";

export function replExtensions(): InterpExtension[] {
	return [
		secretsExtension(),
		promisesExtension(),
		mcpExtension(),
		llmExtension(),
		compactionExtension(),
		proseExtension(),
	];
}

export function newRepl(): MemoryRepl {
	return new MemoryRepl({ extensions: replExtensions() });
}
