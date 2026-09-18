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

export interface MemoryCodec<M> {
	encode(memory: M): StoredMemory;
	decode(row: StoredMemory): M;
}

export type MemoryClient = Pick<ConvexHttpClient, "query" | "mutation">;

export class ConvexMemoryStore<M extends { key: string }> {
	private cache?: Map<string, M>;
	private hydrating?: Promise<Map<string, M>>;

	constructor(
		private readonly workspaceId: Id<"workspaces">,
		private readonly connect: () => MemoryClient,
		private readonly codec: MemoryCodec<M>,
	) {}

	all(): Awaitable<M[]> {
		if (this.cache !== undefined) return [...this.cache.values()];
		return this.hydrate().then((cache) => [...cache.values()]);
	}

	get(key: string): Awaitable<M | undefined> {
		if (this.cache !== undefined) return this.cache.get(key);
		return this.hydrate().then((cache) => cache.get(key));
	}

	put(memory: M): Awaitable<void> {
		return this.hydrate().then(async (cache) => {
			cache.set(memory.key, memory);
			await this.connect().mutation(api.memories.put, {
				workspaceId: this.workspaceId,
				memory: this.codec.encode(memory),
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

	private hydrate(): Promise<Map<string, M>> {
		if (this.cache !== undefined) return Promise.resolve(this.cache);
		this.hydrating ??= this.connect()
			.query(api.memories.list, { workspaceId: this.workspaceId })
			.then((rows) => {
				this.cache = new Map(
					rows.map((row) => [row.key, this.codec.decode(row)] as const),
				);
				return this.cache;
			})
			.finally(() => {
				this.hydrating = undefined;
			});
		return this.hydrating;
	}
}
