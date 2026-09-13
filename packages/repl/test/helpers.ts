import { compactionExtension } from "@repo/interpreter/compaction";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { promisesExtension } from "@repo/interpreter/promises";
import { proseExtension } from "@repo/interpreter/prose";
import { secretsExtension } from "@repo/interpreter/secrets";
import { llmExtension } from "@repo/llm/llm";
import { mcpExtension } from "@repo/mcp";
import { AgentRepl, MemoryRepl } from "../src/repl.ts";

export function modelFacing(): InterpExtension[] {
	return [
		secretsExtension(),
		promisesExtension(),
		mcpExtension(),
		llmExtension(),
		compactionExtension(),
		proseExtension(),
	];
}

export function memoryRepl(
	extensions: InterpExtension[] = modelFacing(),
): MemoryRepl {
	return new MemoryRepl({ extensions });
}

export function agentRepl(
	extensions: InterpExtension[] = modelFacing(),
): AgentRepl {
	return new AgentRepl({ extensions });
}
