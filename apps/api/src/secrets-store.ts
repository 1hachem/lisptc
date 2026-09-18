import type { ConvexSecrets } from "@repo/backend/secrets-store";
import {
	MapSecretsStore,
	type SecretSpec,
	type SecretsStore,
} from "@repo/interpreter/secrets";

export class WriteThroughSecretsStore implements SecretsStore {
	private readonly local = new MapSecretsStore();
	private queue: Promise<void> = Promise.resolve();

	private constructor(private readonly remote: ConvexSecrets) {}

	static async open(remote: ConvexSecrets): Promise<WriteThroughSecretsStore> {
		const store = new WriteThroughSecretsStore(remote);
		for (const { key, value, description } of await remote.load()) {
			store.local.set({ [key]: { value, description } });
		}
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
