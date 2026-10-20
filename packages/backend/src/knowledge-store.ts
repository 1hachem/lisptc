import type {
	BinnedFile,
	KnowledgeStore,
} from "@repo/knowledge-extension/ports";
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

	async attachments(): Promise<string[]> {
		const entries = await this.connect().query(api.attachments.list, {
			workspaceId: this.workspaceId,
		});
		return entries.map((entry) => entry.name);
	}

	async attachment(name: string): Promise<Uint8Array | undefined> {
		const held = await this.connect().query(api.attachments.get, {
			workspaceId: this.workspaceId,
			name,
		});
		if (held?.url == null) return undefined;
		return await this.transfer.download(held.url);
	}

	async attach(
		name: string,
		bytes: Uint8Array,
		contentType: string,
	): Promise<string> {
		const client = this.connect();
		const url = await client.mutation(api.knowledge.uploadUrl, {
			workspaceId: this.workspaceId,
		});
		const storageId = await this.transfer.upload(
			url,
			new Blob([new Uint8Array(bytes)], { type: contentType }),
		);
		const added = await client.mutation(api.attachments.add, {
			workspaceId: this.workspaceId,
			name,
			storageId,
			contentType,
		});
		if ("refused" in added) throw new Error(`${added.refused}: ${name}`);
		return added.name;
	}

	async keep(name: string): Promise<void> {
		const refused = await this.connect().mutation(api.attachments.keep, {
			workspaceId: this.workspaceId,
			name,
		});
		if (refused !== null) throw new Error(`${refused}: ${name}`);
	}

	async unattach(name: string): Promise<void> {
		const removed = await this.connect().mutation(api.attachments.remove, {
			workspaceId: this.workspaceId,
			name,
		});
		if (!removed) throw new Error(`no file ${name} in attachments`);
	}

	async binned(): Promise<BinnedFile[]> {
		const entries = await this.connect().query(api.bin.list, {
			workspaceId: this.workspaceId,
		});
		return entries.map(({ name, from }) => ({ name, from }));
	}

	async restore(name: string): Promise<BinnedFile> {
		const restored = await this.connect().mutation(api.bin.restore, {
			workspaceId: this.workspaceId,
			name,
		});
		if ("refused" in restored) throw new Error(`${restored.refused}: ${name}`);
		return { name: restored.name, from: restored.folder };
	}

	async erase(name: string): Promise<void> {
		const removed = await this.connect().mutation(api.bin.remove, {
			workspaceId: this.workspaceId,
			name,
		});
		if (!removed) throw new Error(`no file ${name} in the bin`);
	}
}
