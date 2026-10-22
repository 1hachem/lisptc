import type {
	BinnedFile,
	KnowledgeStore,
} from "@repo/knowledge-extension/ports";
import type { StoreFolder } from "@repo/shared/files";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export type KnowledgeStoreClient = Pick<
	ConvexHttpClient,
	"query" | "mutation" | "url"
>;

function onDeployment(served: string, client: KnowledgeStoreClient): string {
	const url = new URL(served);
	const deployment = new URL(client.url);
	url.protocol = deployment.protocol;
	url.host = deployment.host;
	return url.href;
}

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

	async names(folder: StoreFolder): Promise<string[]> {
		const entries = await this.connect().query(api.files.list, {
			workspaceId: this.workspaceId,
			folder,
		});
		return entries.map((entry) => entry.name);
	}

	async read(
		folder: StoreFolder,
		name: string,
	): Promise<Uint8Array | undefined> {
		const client = this.connect();
		const held = await client.query(api.files.get, {
			workspaceId: this.workspaceId,
			folder,
			name,
		});
		if (held?.url == null) return undefined;
		return await this.transfer.download(onDeployment(held.url, client));
	}

	async write(
		folder: StoreFolder,
		name: string,
		bytes: Uint8Array,
		contentType: string,
	): Promise<string> {
		const client = this.connect();
		const url = await client.mutation(api.files.uploadUrl, {
			workspaceId: this.workspaceId,
		});
		const storageId = await this.transfer.upload(
			onDeployment(url, client),
			new Blob([new Uint8Array(bytes)], { type: contentType }),
		);
		const added = await client.mutation(api.files.add, {
			workspaceId: this.workspaceId,
			folder,
			name,
			storageId,
			contentType,
		});
		if ("refused" in added) throw new Error(`${added.refused}: ${name}`);
		return added.name;
	}

	async remove(folder: StoreFolder, name: string): Promise<void> {
		const removed = await this.connect().mutation(api.files.remove, {
			workspaceId: this.workspaceId,
			folder,
			name,
		});
		if (!removed) throw new Error(`no file ${name} in ${folder}`);
	}

	async keep(name: string): Promise<void> {
		const refused = await this.connect().mutation(api.files.keep, {
			workspaceId: this.workspaceId,
			name,
		});
		if (refused !== null) throw new Error(`${refused}: ${name}`);
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
