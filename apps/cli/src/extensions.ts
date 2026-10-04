import { join } from "node:path";
import { Compactor, compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { diagnosticsExtension } from "@repo/diagnostics-extension";
import { diagnosticsHost } from "@repo/diagnostics-extension/host";
import type { InterpExtension } from "@repo/interpreter/session";
import { llmExtension } from "@repo/llm-extension/llm-extension";
import { llmHost } from "@repo/llm-extension/llm-host";
import { mcpExtension } from "@repo/mcp-extension";
import { DockerHost } from "@repo/mcp-extension/docker-host";
import { LocalProcessHost } from "@repo/mcp-extension/local-host";
import { mcpHostFor } from "@repo/mcp-extension/mcp-host";
import { memoryExtension } from "@repo/memory-extension";
import {
	memoryHost,
	memoryHostFor,
	SplitMemoryStore,
} from "@repo/memory-extension/host";
import type { MemoryHost } from "@repo/memory-extension/ports";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { secretsExtension } from "@repo/secrets-extension";
import { secretsHost, secretsHostFor } from "@repo/secrets-extension/host";
import { workspaceExtension } from "@repo/workspace-extension";
import { workspaceHostFor } from "@repo/workspace-extension/host";
import { MEMORIES, RUNTIME_DIR } from "@repo/workspace-extension/ports";

function workspaceAt(root: string | undefined): InterpExtension[] {
	return root === undefined ? [] : [workspaceExtension(workspaceHostFor(root))];
}

function memoryAt(root: string | undefined): MemoryHost {
	if (root === undefined) return memoryHost;
	return {
		...memoryHostFor(),
		store: new SplitMemoryStore(
			join(root, MEMORIES),
			join(root, RUNTIME_DIR, MEMORIES),
		),
	};
}

export function cliExtensions(workspace?: string): InterpExtension[] {
	return [
		...workspaceAt(workspace),
		secretsExtension(secretsHostFor({ envFile: true })),
		promisesExtension(promisesHost),
		mcpExtension(mcpHostFor({ host: new DockerHost() })),
		llmExtension(llmHost),
		compactionExtension(compactionHost, { compactor: new Compactor() }),
		memoryExtension(memoryAt(workspace)),
		proseExtension(proseHost),
		diagnosticsExtension(diagnosticsHost),
	];
}

export function sessionExtensions(workspace?: string): InterpExtension[] {
	return [
		...workspaceAt(workspace),
		secretsExtension(secretsHost),
		promisesExtension(promisesHost),
		mcpExtension(mcpHostFor({ host: new LocalProcessHost() })),
		llmExtension(llmHost),
		compactionExtension(compactionHost),
		memoryExtension(memoryAt(workspace)),
		proseExtension(proseHost),
		diagnosticsExtension(diagnosticsHost),
	];
}
