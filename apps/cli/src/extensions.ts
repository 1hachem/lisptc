import { Compactor, compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { llmExtension } from "@repo/llm-extension/llm-extension";
import { mcpExtension } from "@repo/mcp-extension";
import { DockerHost } from "@repo/mcp-extension/docker-host";
import { mcpHostFor } from "@repo/mcp-extension/mcp-host";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { promisesExtension } from "@repo/promises-extension";
import { proseExtension } from "@repo/prose-extension";
import { secretsExtension } from "@repo/secrets-extension";
import { secretsHostFor } from "@repo/secrets-extension/host";

export function cliExtensions(): InterpExtension[] {
	return [
		secretsExtension(secretsHostFor({ envFile: true })),
		promisesExtension(),
		mcpExtension(mcpHostFor({ host: new DockerHost() })),
		llmExtension(),
		compactionExtension(compactionHost, { compactor: new Compactor() }),
		memoryExtension(memoryHost),
		proseExtension(),
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
