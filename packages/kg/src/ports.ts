import type { Awaitable, PromptSource } from "@repo/shared/host";

export interface StoredGraph {
	name: string;
	source: string;
}

export interface GraphStore {
	all(): Awaitable<StoredGraph[]>;
	put(graph: StoredGraph): Awaitable<void>;
	remove(name: string): Awaitable<boolean>;
}

export interface KgHost {
	store: GraphStore;
	prompt: PromptSource;
	memories: PromptSource;
}
