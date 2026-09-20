import { compactionExtension } from "@repo/compaction-extension";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { memoryExtension } from "@repo/memory-extension";
import { promisesExtension } from "@repo/promises-extension";
import { proseExtension } from "@repo/prose-extension";
import { secretsExtension } from "@repo/secrets-extension";
import { llmExtension } from "@repo/llm-extension/llm-extension";
import { mcpExtension } from "@repo/mcp-extension";

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
		mcpExtension(),
		llmExtension(),
		compactionExtension(),
		memoryExtension(),
		proseExtension(),
	];
}
