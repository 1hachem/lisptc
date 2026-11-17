import type { GraphStore, StoredGraph } from "@repo/kg-extension/ports";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export type GraphClient = Pick<ConvexHttpClient, "query" | "mutation">;

export class ConvexGraphStore implements GraphStore {
	constructor(
		private readonly workspaceId: Id<"workspaces">,
		private readonly connect: () => GraphClient,
	) {}

	async all(): Promise<StoredGraph[]> {
		const rows = await this.connect().query(api.graphs.list, {
			workspaceId: this.workspaceId,
		});
		return rows.map(({ name, source }) => ({ name, source }));
	}

	async put({ name, source }: StoredGraph): Promise<void> {
		await this.connect().mutation(api.graphs.put, {
			workspaceId: this.workspaceId,
			name,
			source,
		});
	}

	async remove(name: string): Promise<boolean> {
		return await this.connect().mutation(api.graphs.remove, {
			workspaceId: this.workspaceId,
			name,
		});
	}
}
