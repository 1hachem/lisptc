import type { PermissionsStore } from "@repo/permissions-extension/ports";
import { parseRules } from "@repo/permissions-extension/rules";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export type PermissionsClient = Pick<ConvexHttpClient, "query" | "mutation">;

export class ConvexPermissionsStore implements PermissionsStore {
	private constructor(
		private readonly workspaceId: Id<"workspaces">,
		private readonly connect: () => PermissionsClient,
		private text: string,
	) {}

	static async open(
		workspaceId: Id<"workspaces">,
		connect: () => PermissionsClient,
	): Promise<ConvexPermissionsStore> {
		const source = await connect().query(api.permissions.get, { workspaceId });
		return new ConvexPermissionsStore(workspaceId, connect, source ?? "");
	}

	source(): string {
		return this.text;
	}

	async save(source: string): Promise<void> {
		parseRules(source);
		await this.connect().mutation(api.permissions.put, {
			workspaceId: this.workspaceId,
			source,
		});
		this.text = source;
	}
}
