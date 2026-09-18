import type { MemoryCodec, StoredMemory } from "@repo/backend/memory-store";
import { Reader, str } from "@repo/interpreter";
import {
	type Memory,
	parseTrigger,
	triggerToForm,
} from "@repo/interpreter/memory";

function readForm(text: string): unknown {
	const reader = new Reader();
	reader.push(text);
	return reader.read();
}

export const lispMemoryCodec: MemoryCodec<Memory> = {
	encode(memory: Memory): StoredMemory {
		return {
			key: memory.key,
			body: str(memory.body),
			...(memory.on === undefined ? {} : { on: str(triggerToForm(memory.on)) }),
			links: [...memory.links].map(([key, weight]) => ({ key, weight })),
			score: memory.score,
			used: memory.used,
			lastUsed: memory.lastUsed,
		};
	},

	decode(row: StoredMemory): Memory {
		return {
			key: row.key,
			body: readForm(row.body),
			on: row.on === undefined ? undefined : parseTrigger(readForm(row.on)),
			links: new Map(row.links.map(({ key, weight }) => [key, weight])),
			score: row.score,
			used: row.used,
			lastUsed: row.lastUsed,
		};
	},
};
