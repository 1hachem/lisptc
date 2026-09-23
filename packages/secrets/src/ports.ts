import type { PromptSource } from "@repo/shared/host";

export type SecretSpec = string | { value: string; description?: string };

export const SECRET_ENV_PREFIX = "REPL_";

export interface SecretsStore {
	get(key: string): { value: string; description: string } | undefined;
	list(): Array<[string, string]>;
	set(record: Record<string, SecretSpec>): void;
}

export class MapSecretsStore implements SecretsStore {
	private readonly secrets = new Map<
		string,
		{ value: string; description: string }
	>();

	get(key: string): { value: string; description: string } | undefined {
		return this.secrets.get(key);
	}

	list(): Array<[string, string]> {
		return [...this.secrets].map(([key, { description }]) => [
			key,
			description,
		]);
	}

	set(record: Record<string, SecretSpec>): void {
		for (const [key, spec] of Object.entries(record)) {
			if (!key.startsWith(SECRET_ENV_PREFIX)) continue;
			const value = typeof spec === "string" ? spec : spec.value;
			const description =
				typeof spec === "string" ? "" : (spec.description ?? "");
			this.secrets.set(key, { value, description });
		}
	}
}

export interface SecretsHost {
	store: SecretsStore;
	prompt: PromptSource;
}
