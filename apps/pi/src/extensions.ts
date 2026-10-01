import { Compactor, compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import type { InterpExtension } from "@repo/interpreter/session";
import { llmExtension } from "@repo/llm-extension/llm-extension";
import { llmHost } from "@repo/llm-extension/llm-host";
import { mcpExtension } from "@repo/mcp-extension";
import { DockerHost } from "@repo/mcp-extension/docker-host";
import { mcpHostFor } from "@repo/mcp-extension/mcp-host";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { secretsExtension } from "@repo/secrets-extension";
import { secretsHostFor } from "@repo/secrets-extension/host";

export function piExtensions(): InterpExtension[] {
	return [
		secretsExtension(secretsHostFor({ envFile: true })),
		promisesExtension(promisesHost),
		mcpExtension(mcpHostFor({ host: new DockerHost() })),
		llmExtension(llmHost),
		compactionExtension(compactionHost, { compactor: new Compactor() }),
		memoryExtension(memoryHost),
		proseExtension(proseHost),
	];
}
