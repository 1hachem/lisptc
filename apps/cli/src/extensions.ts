import { Compactor, compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { diagnosticsExtension } from "@repo/diagnostics-extension";
import { diagnosticsHost } from "@repo/diagnostics-extension/host";
import type { InterpExtension } from "@repo/interpreter/session";
import { introspectionExtension } from "@repo/introspection-extension";
import { introspectionHost } from "@repo/introspection-extension/host";
import { llmExtension } from "@repo/llm-extension/llm-extension";
import { llmHost } from "@repo/llm-extension/llm-host";
import { mcpExtension } from "@repo/mcp-extension";
import { DockerHost } from "@repo/mcp-extension/docker-host";
import { LocalProcessHost } from "@repo/mcp-extension/local-host";
import { mcpHostFor } from "@repo/mcp-extension/mcp-host";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { permissionsExtension } from "@repo/permissions-extension";
import { permissionsHostFor } from "@repo/permissions-extension/host";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { secretsExtension } from "@repo/secrets-extension";
import { secretsHost, secretsHostFor } from "@repo/secrets-extension/host";

export function cliExtensions(): InterpExtension[] {
	const memory = memoryExtension(memoryHost);
	const permissions = permissionsExtension(
		permissionsHostFor({ asks: memory.asks }),
	);
	return [
		permissions,
		secretsExtension(secretsHostFor({ envFile: true })),
		promisesExtension(promisesHost),
		introspectionExtension(introspectionHost),
		mcpExtension({
			...mcpHostFor({ host: new DockerHost() }),
			policy: permissions.rules,
		}),
		llmExtension(llmHost),
		compactionExtension(compactionHost, { compactor: new Compactor() }),
		memory,
		proseExtension(proseHost),
		diagnosticsExtension(diagnosticsHost),
	];
}

export function sessionExtensions(): InterpExtension[] {
	const memory = memoryExtension(memoryHost);
	const permissions = permissionsExtension(
		permissionsHostFor({ asks: memory.asks }),
	);
	return [
		permissions,
		secretsExtension(secretsHost),
		promisesExtension(promisesHost),
		introspectionExtension(introspectionHost),
		mcpExtension({
			...mcpHostFor({ host: new LocalProcessHost() }),
			policy: permissions.rules,
		}),
		llmExtension(llmHost),
		compactionExtension(compactionHost),
		memory,
		proseExtension(proseHost),
		diagnosticsExtension(diagnosticsHost),
	];
}
