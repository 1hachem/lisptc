import { str } from "@repo/interpreter/print";
import { memoryHost } from "../src/memory-host.ts";
import {
	type Memory,
	type MemoryHost,
	type MemoryWrite,
	memoryToRecord,
	memoryToSource,
} from "../src/ports.ts";

export const bareHost: MemoryHost = {
	...memoryHost,
	languageMemories: () => "",
	memories: () => "",
};

export function written(memory: Memory): MemoryWrite {
	return {
		record: memoryToRecord(memory),
		source: str(memoryToSource(memory)),
	};
}
