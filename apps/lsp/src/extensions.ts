import { compactionExtension } from "@repo/compaction-extension";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { llmExtension } from "@repo/llm-extension/llm-extension";
import { mcpExtension } from "@repo/mcp-extension";
import { LocalProcessHost } from "@repo/mcp-extension/local-host";
import { mcpHostFor } from "@repo/mcp-extension/mcp-host";
import { memoryExtension } from "@repo/memory-extension";
import { promisesExtension } from "@repo/promises-extension";
import { proseExtension } from "@repo/prose-extension";
import { secretsExtension } from "@repo/secrets-extension";

export function docExtensions(): InterpExtension[] {
	return [
		promisesExtension(),
		mcpExtension(),
		llmExtension(),
		compactionExtension(),
	];
}

export function sessionExtensions(): InterpExtension[] {
	return [
		secretsExtension(),
		promisesExtension(),
		mcpExtension(mcpHostFor({ host: new LocalProcessHost() })),
		llmExtension(),
		compactionExtension(),
		memoryExtension(),
		proseExtension(),
	];
}
