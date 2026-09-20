import { Reader, str } from "@repo/interpreter";
import {
	type Memory,
	type MemoryStore,
	parseTrigger,
	triggerToForm,
} from "@repo/memory-extension";
import type { Awaitable } from "@repo/shared/host";
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
	private cache?: Map<string, Memory>;
	private hydrating?: Promise<Map<string, Memory>>;

	constructor(
		private readonly workspaceId: Id<"workspaces">,
		private readonly connect: () => MemoryClient,
	) {}

	all(): Awaitable<Memory[]> {
		if (this.cache !== undefined) return [...this.cache.values()];
		return this.hydrate().then((cache) => [...cache.values()]);
	}

	get(key: string): Awaitable<Memory | undefined> {
		if (this.cache !== undefined) return this.cache.get(key);
		return this.hydrate().then((cache) => cache.get(key));
	}

	put(memory: Memory): Awaitable<void> {
		return this.hydrate().then(async (cache) => {
			cache.set(memory.key, memory);
			await this.connect().mutation(api.memories.put, {
				workspaceId: this.workspaceId,
				memory: encodeMemory(memory),
			});
		});
	}

	delete(key: string): Awaitable<boolean> {
		return this.hydrate().then(async (cache) => {
			cache.delete(key);
			return await this.connect().mutation(api.memories.remove, {
				workspaceId: this.workspaceId,
				key,
			});
		});
	}

	private hydrate(): Promise<Map<string, Memory>> {
		if (this.cache !== undefined) return Promise.resolve(this.cache);
		this.hydrating ??= this.connect()
			.query(api.memories.list, { workspaceId: this.workspaceId })
			.then((rows) => {
				this.cache = new Map(
					rows.map((row) => [row.key, decodeMemory(row)] as const),
				);
				return this.cache;
			})
			.finally(() => {
				this.hydrating = undefined;
			});
		return this.hydrating;
	}
}
