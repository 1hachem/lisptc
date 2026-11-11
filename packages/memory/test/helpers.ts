import { ConversationInterpreter } from "@repo/interpreter/conversation";
import { str } from "@repo/interpreter/print";
import { LANGUAGE_MEMORIES } from "@repo/interpreter/source";
import { memoryHost } from "../src/memory-host.ts";
import {
	type Memory,
	type MemoryHost,
	type MemoryWrite,
	memoryToRecord,
	memoryToSource,
} from "../src/ports.ts";

export const bareHost: MemoryHost = { ...memoryHost, memories: () => "" };

export class MemoryInterp extends ConversationInterpreter {
	override builtinMemories(): readonly string[] {
		return super.builtinMemories().filter((text) => text !== LANGUAGE_MEMORIES);
	}
}

export function written(memory: Memory): MemoryWrite {
	return {
		record: memoryToRecord(memory),
		source: str(memoryToSource(memory)),
	};
}
