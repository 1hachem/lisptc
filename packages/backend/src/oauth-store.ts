import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export type OAuthClient = Pick<ConvexHttpClient, "query" | "mutation">;

export class ConvexOAuthStore<R> {
	constructor(
		private readonly workspaceId: Id<"workspaces">,
		private readonly connect: () => OAuthClient,
	) {}

	async load(serverKey: string): Promise<R | undefined> {
		const record = await this.connect().query(api.oauth.get, {
			workspaceId: this.workspaceId,
			serverKey,
		});
		if (record === null) return undefined;
		try {
			return JSON.parse(record) as R;
		} catch {
			return undefined;
		}
	}

	async save(serverKey: string, record: R): Promise<void> {
		await this.connect().mutation(api.oauth.put, {
			workspaceId: this.workspaceId,
			serverKey,
			record: JSON.stringify(record),
		});
	}

	async clear(serverKey: string): Promise<void> {
		await this.connect().mutation(api.oauth.remove, {
			workspaceId: this.workspaceId,
			serverKey,
		});
	}
}
