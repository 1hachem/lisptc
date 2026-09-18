import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export interface StoredSecret {
	key: string;
	value: string;
	description: string;
}

export type SecretsClient = Pick<ConvexHttpClient, "query" | "mutation">;

export class ConvexSecrets {
	constructor(
		private readonly workspaceId: Id<"workspaces">,
		private readonly connect: () => SecretsClient,
	) {}

	async load(): Promise<StoredSecret[]> {
		const rows = await this.connect().query(api.secrets.list, {
			workspaceId: this.workspaceId,
		});
		return rows.map(({ key, value, description }) => ({
			key,
			value,
			description,
		}));
	}

	async save(secret: StoredSecret): Promise<void> {
		await this.connect().mutation(api.secrets.put, {
			workspaceId: this.workspaceId,
			secret,
		});
	}

	async remove(key: string): Promise<boolean> {
		return await this.connect().mutation(api.secrets.remove, {
			workspaceId: this.workspaceId,
			key,
		});
	}
}
