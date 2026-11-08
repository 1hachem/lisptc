import type { MemoryRecord, MemoryStore } from "@repo/memory-extension/ports";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

function recordOf(row: MemoryRecord): MemoryRecord {
	return {
		key: row.key,
		body: row.body,
		...(row.on === undefined ? {} : { on: row.on }),
		links: row.links.map(({ key, weight }) => ({ key, weight })),
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

	async all(): Promise<MemoryRecord[]> {
		const rows = await this.connect().query(api.memories.list, {
			workspaceId: this.workspaceId,
		});
		return rows.map(recordOf);
	}

	async get(key: string): Promise<MemoryRecord | undefined> {
		const row = await this.connect().query(api.memories.get, {
			workspaceId: this.workspaceId,
			key,
		});
		return row === null ? undefined : recordOf(row);
	}

	async put(record: MemoryRecord): Promise<void> {
		await this.connect().mutation(api.memories.put, {
			workspaceId: this.workspaceId,
			memory: recordOf(record),
		});
	}

	async delete(key: string): Promise<boolean> {
		return await this.connect().mutation(api.memories.remove, {
			workspaceId: this.workspaceId,
			key,
		});
	}
}
