import { Compactor, compactionExtension } from "@repo/interpreter/compaction";
import { compactionHost } from "@repo/interpreter/compaction-host";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { memoryExtension } from "@repo/interpreter/memory";
import { memoryHost } from "@repo/interpreter/memory-host";
import { promisesExtension } from "@repo/interpreter/promises";
import { proseExtension } from "@repo/interpreter/prose";
import { secretsExtension } from "@repo/interpreter/secrets";
import { secretsHostFor } from "@repo/interpreter/secrets-host";
import { llmExtension } from "@repo/llm/llm";
import { mcpExtension } from "@repo/mcp";
import { DockerHost } from "@repo/mcp/docker-host";
import { mcpHostFor } from "@repo/mcp/mcp-host";

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
