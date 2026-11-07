import { str } from "@repo/interpreter/print";
import { Reader } from "@repo/interpreter/reader";
import {
	type Memory,
	type MemoryStore,
	parseTrigger,
	triggerToForm,
} from "@repo/memory-extension/ports";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export interface StoredMemory {
	key: string;
	body: string;
	on?: string;
	links: { key: string; weight: number }[];
	score: number;
	used: number;
	lastUsed: number;
}

function readForm(text: string): unknown {
	const reader = new Reader();
	reader.push(text);
	return reader.read();
}

export function encodeMemory(memory: Memory): StoredMemory {
	return {
		key: memory.key,
		body: str(memory.body),
		...(memory.on === undefined ? {} : { on: str(triggerToForm(memory.on)) }),
		links: [...memory.links].map(([key, weight]) => ({ key, weight })),
		score: memory.score,
		used: memory.used,
		lastUsed: memory.lastUsed,
	};
}

export function decodeMemory(row: StoredMemory): Memory {
	return {
		key: row.key,
		body: readForm(row.body),
		on: row.on === undefined ? undefined : parseTrigger(readForm(row.on)),
		links: new Map(row.links.map(({ key, weight }) => [key, weight])),
		score: row.score,
		used: row.used,
		lastUsed: row.lastUsed,
	};
}

export type MemoryClient = Pick<ConvexHttpClient, "query" | "mutation">;

export class ConvexMemoryStore implements MemoryStore {
	constructor(
		private readonly workspaceId: Id<"workspaces">,
		private readonly connect: () => MemoryClient,
	) {}

	async all(): Promise<Memory[]> {
		const rows = await this.connect().query(api.memories.list, {
			workspaceId: this.workspaceId,
		});
		return rows.map(decodeMemory);
	}

	async get(key: string): Promise<Memory | undefined> {
		const row = await this.connect().query(api.memories.get, {
			workspaceId: this.workspaceId,
			key,
		});
		return row === null ? undefined : decodeMemory(row);
	}

	async put(memory: Memory): Promise<void> {
		await this.connect().mutation(api.memories.put, {
			workspaceId: this.workspaceId,
			memory: encodeMemory(memory),
		});
	}

	async delete(key: string): Promise<boolean> {
		return await this.connect().mutation(api.memories.remove, {
			workspaceId: this.workspaceId,
			key,
		});
	}
}
