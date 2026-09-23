import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import type { InterpExtension } from "@repo/interpreter/session";
import { llmExtension } from "@repo/llm-extension/llm-extension";
import { llmHost } from "@repo/llm-extension/llm-host";
import { mcpExtension } from "@repo/mcp-extension";
import { LocalProcessHost } from "@repo/mcp-extension/local-host";
import { mcpHost, mcpHostFor } from "@repo/mcp-extension/mcp-host";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { secretsExtension } from "@repo/secrets-extension";
import { secretsHost } from "@repo/secrets-extension/host";

export function docExtensions(): InterpExtension[] {
	return [
		promisesExtension(promisesHost),
		mcpExtension(mcpHost),
		llmExtension(llmHost),
		compactionExtension(compactionHost),
	];
}

export function sessionExtensions(): InterpExtension[] {
	return [
		secretsExtension(secretsHost),
		promisesExtension(promisesHost),
		mcpExtension(mcpHostFor({ host: new LocalProcessHost() })),
		llmExtension(llmHost),
		compactionExtension(compactionHost),
		memoryExtension(memoryHost),
		proseExtension(proseHost),
	];
}
