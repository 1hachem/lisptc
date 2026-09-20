import { compactionExtension } from "@repo/compaction-extension";
import { llmExtension } from "@repo/llm-extension/llm-extension";
import { mcpExtension } from "@repo/mcp-extension";
import { memoryExtension } from "@repo/memory-extension";
import { promisesExtension } from "@repo/promises-extension";
import { proseExtension } from "@repo/prose-extension";
import { MemoryRepl } from "@repo/repl/repl";
import { secretsExtension } from "@repo/secrets-extension";

export function newRepl(): MemoryRepl {
	return new MemoryRepl({
		extensions: [
			secretsExtension(),
			promisesExtension(),
			mcpExtension(),
			llmExtension(),
			compactionExtension(),
			memoryExtension(),
			proseExtension(),
		],
	});
}
