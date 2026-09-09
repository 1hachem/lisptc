import {
	type Compactor,
	compactionExtension,
} from "@repo/interpreter/compaction";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { mcpExtension } from "@repo/interpreter/mcp";
import { proseExtension } from "@repo/interpreter/prose";
import { type SecretsStore, secretsExtension } from "@repo/interpreter/secrets";
import { type LlmObserver, llmExtension } from "@repo/llm/llm";

export function modelFacingExtensions(options: {
	compactor: Compactor;
	secrets: SecretsStore;
	envFile?: boolean;
	observe?: LlmObserver;
}): InterpExtension[] {
	return [
		secretsExtension({
			store: options.secrets,
			...(options.envFile ? { envFile: true } : {}),
		}),
		mcpExtension(),
		llmExtension(options.observe ? { observe: options.observe } : {}),
		compactionExtension(options.compactor),
		proseExtension(),
	];
}
