import type { KnowledgeStore } from "@repo/knowledge-extension/ports";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export type KnowledgeStoreClient = Pick<ConvexHttpClient, "query" | "mutation">;

export interface BlobTransfer {
	download(url: string): Promise<Uint8Array>;
	upload(url: string, blob: Blob): Promise<Id<"_storage">>;
}

const httpTransfer: BlobTransfer = {
	async download(url) {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`download failed: ${response.status}`);
		return new Uint8Array(await response.arrayBuffer());
	},
	async upload(url, blob) {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": blob.type },
			body: blob,
		});
		if (!response.ok) throw new Error(`upload failed: ${response.status}`);
		const { storageId } = (await response.json()) as {
			storageId: Id<"_storage">;
		};
		return storageId;
	},
};

export class ConvexKnowledgeStore implements KnowledgeStore {
	constructor(
		private readonly workspaceId: Id<"workspaces">,
		private readonly connect: () => KnowledgeStoreClient,
		private readonly transfer: BlobTransfer = httpTransfer,
	) {}

	async files(): Promise<string[]> {
		const entries = await this.connect().query(api.knowledge.list, {
			workspaceId: this.workspaceId,
		});
		return entries.map((entry) => entry.name);
	}

	async file(name: string): Promise<Uint8Array | undefined> {
		const held = await this.connect().query(api.knowledge.get, {
			workspaceId: this.workspaceId,
			name,
		});
		if (held?.url == null) return undefined;
		return await this.transfer.download(held.url);
	}

	async write(name: string, text: string, contentType: string): Promise<void> {
		const client = this.connect();
		const url = await client.mutation(api.knowledge.uploadUrl, {
			workspaceId: this.workspaceId,
		});
		const storageId = await this.transfer.upload(
			url,
			new Blob([text], { type: contentType }),
		);
		const refused = await client.mutation(api.knowledge.add, {
			workspaceId: this.workspaceId,
			name,
			storageId,
			contentType,
		});
		if (refused !== null) throw new Error(`${refused}: ${name}`);
	}

	async remove(name: string): Promise<void> {
		const removed = await this.connect().mutation(api.knowledge.remove, {
			workspaceId: this.workspaceId,
			name,
		});
		if (!removed) throw new Error(`no file ${name}`);
	}
}
