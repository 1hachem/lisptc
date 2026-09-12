import {
	type CompactionExtension,
	compactionExtension,
} from "@repo/interpreter/compaction";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { mcpExtension } from "@repo/interpreter/mcp";
import { proseExtension } from "@repo/interpreter/prose";
import {
	type SecretsExtension,
	secretsExtension,
} from "@repo/interpreter/secrets";
import { type LlmExtension, llmExtension } from "@repo/llm/llm";

export interface ModelFacingParts {
	secrets?: SecretsExtension;
	mcp?: InterpExtension;
	llm?: LlmExtension;
	compaction?: CompactionExtension;
	extra?: InterpExtension[];
}

export function modelFacingExtensions(
	parts: ModelFacingParts = {},
): InterpExtension[] {
	return [
		parts.secrets ?? secretsExtension(),
		parts.mcp ?? mcpExtension(),
		parts.llm ?? llmExtension(),
		parts.compaction ?? compactionExtension(),
		proseExtension(),
		...(parts.extra ?? []),
	];
}
