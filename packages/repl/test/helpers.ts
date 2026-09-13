import {
	type CompactionExtension,
	compactionExtension,
} from "@repo/interpreter/compaction";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { promisesExtension } from "@repo/interpreter/promises";
import { proseExtension } from "@repo/interpreter/prose";
import {
	type SecretsExtension,
	secretsExtension,
} from "@repo/interpreter/secrets";
import { type LlmExtension, llmExtension } from "@repo/llm/llm";
import { mcpExtension } from "@repo/mcp";
import { AgentRepl, MemoryRepl } from "../src/repl.ts";

export interface ModelFacingParts {
	secrets?: SecretsExtension;
	mcp?: InterpExtension;
	llm?: LlmExtension;
	compaction?: CompactionExtension;
}

export function modelFacing(parts: ModelFacingParts = {}): InterpExtension[] {
	return [
		parts.secrets ?? secretsExtension(),
		promisesExtension(),
		parts.mcp ?? mcpExtension(),
		parts.llm ?? llmExtension(),
		parts.compaction ?? compactionExtension(),
		proseExtension(),
	];
}

export function memoryRepl(parts: ModelFacingParts = {}): MemoryRepl {
	return new MemoryRepl({ extensions: modelFacing(parts) });
}

export function agentRepl(parts: ModelFacingParts = {}): AgentRepl {
	return new AgentRepl({ extensions: modelFacing(parts) });
}
