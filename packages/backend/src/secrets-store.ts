import {
	MapSecretsStore,
	type SecretSpec,
	type SecretsStore,
} from "@repo/interpreter/secrets";
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

export class ConvexSecretsStore implements SecretsStore {
	private readonly local = new MapSecretsStore();
	private queue: Promise<void> = Promise.resolve();

	private constructor(private readonly remote: ConvexSecrets) {}

	static async open(
		workspaceId: Id<"workspaces">,
		connect: () => SecretsClient,
	): Promise<ConvexSecretsStore> {
		const store = new ConvexSecretsStore(
			new ConvexSecrets(workspaceId, connect),
		);
		for (const { key, value, description } of await store.remote.load())
			store.local.set({ [key]: { value, description } });
		return store;
	}

	get(key: string): { value: string; description: string } | undefined {
		return this.local.get(key);
	}

	list(): Array<[string, string]> {
		return this.local.list();
	}

	set(record: Record<string, SecretSpec>): void {
		this.local.set(record);
		for (const key of Object.keys(record)) {
			const stored = this.local.get(key);
			if (stored === undefined) continue;
			this.enqueue(() => this.remote.save({ key, ...stored }));
		}
	}

	flush(): Promise<void> {
		return this.queue;
	}

	private enqueue(write: () => Promise<unknown>): void {
		this.queue = this.queue
			.then(write)
			.then(() => undefined)
			.catch((ex) => {
				console.error(
					"could not persist a secret:",
					ex instanceof Error ? ex.message : String(ex),
				);
			});
	}
}
