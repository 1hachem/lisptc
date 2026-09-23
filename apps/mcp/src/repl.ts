import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { llmExtension } from "@repo/llm-extension/llm-extension";
import { llmHost } from "@repo/llm-extension/llm-host";
import { mcpExtension } from "@repo/mcp-extension";
import { mcpHost } from "@repo/mcp-extension/mcp-host";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { MemoryRepl } from "@repo/repl/repl";
import { secretsExtension } from "@repo/secrets-extension";
import { secretsHost } from "@repo/secrets-extension/host";

export function newRepl(): MemoryRepl {
	return new MemoryRepl({
		extensions: [
			secretsExtension(secretsHost),
			promisesExtension(promisesHost),
			mcpExtension(mcpHost),
			llmExtension(llmHost),
			compactionExtension(compactionHost),
			memoryExtension(memoryHost),
			proseExtension(proseHost),
		],
	});
}
