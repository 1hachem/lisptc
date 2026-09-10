import {
	type Compactor,
	compactionExtension,
} from "@repo/interpreter/compaction";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { mcpExtension } from "@repo/interpreter/mcp";
import type { Dispatch } from "@repo/interpreter/promises";
import { proseExtension } from "@repo/interpreter/prose";
import { type SecretsStore, secretsExtension } from "@repo/interpreter/secrets";
import { type LlmObserver, llmExtension } from "@repo/llm/llm";

export interface ModelFacingOptions {
	compactor: Compactor;
	secrets: SecretsStore;
	envFile?: boolean;
	observe?: LlmObserver;
	mcpDispatch?: Dispatch;
	toolkitJson?: string;
	extra?: InterpExtension[];
}

export function modelFacingExtensions(
	options: ModelFacingOptions,
): InterpExtension[] {
	return [
		secretsExtension({
			store: options.secrets,
			...(options.envFile ? { envFile: true } : {}),
		}),
		mcpExtension({
			...(options.mcpDispatch ? { dispatch: options.mcpDispatch } : {}),
			...(options.toolkitJson ? { toolkitJson: options.toolkitJson } : {}),
		}),
		llmExtension(options.observe ? { observe: options.observe } : {}),
		compactionExtension(options.compactor),
		proseExtension(),
		...(options.extra ?? []),
	];
}
