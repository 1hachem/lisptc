import type { SourceFolder } from "@repo/shared/host";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export type SourceClient = Pick<ConvexHttpClient, "query" | "mutation">;

function workspaceOf(workspace: string): Id<"workspaces"> {
	return workspace as Id<"workspaces">;
}

export class ConvexSourceFolder implements SourceFolder {
	constructor(private readonly connect: () => SourceClient) {}

	async list(workspace: string, folder: string): Promise<string[]> {
		return await this.connect().query(api.sources.list, {
			workspaceId: workspaceOf(workspace),
			folder,
		});
	}

	async read(
		workspace: string,
		folder: string,
		name: string,
	): Promise<string | undefined> {
		const text = await this.connect().query(api.sources.get, {
			workspaceId: workspaceOf(workspace),
			folder,
			name,
		});
		return text ?? undefined;
	}

	async write(
		workspace: string,
		folder: string,
		name: string,
		text: string,
	): Promise<void> {
		await this.connect().mutation(api.sources.put, {
			workspaceId: workspaceOf(workspace),
			folder,
			name,
			text,
		});
	}

	async remove(
		workspace: string,
		folder: string,
		name: string,
	): Promise<boolean> {
		return await this.connect().mutation(api.sources.remove, {
			workspaceId: workspaceOf(workspace),
			folder,
			name,
		});
	}
}
