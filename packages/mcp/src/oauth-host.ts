import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { oauthEnv } from "@repo/env/oauth";
import type { OAuthRecord, OAuthStore } from "./ports.ts";

function defaultOAuthDir(): string {
	const dir = oauthEnv.LISPTC_OAUTH_DIR;
	if (dir) return dir;
	const configHome = oauthEnv.XDG_CONFIG_HOME ?? join(homedir(), ".config");
	return join(configHome, "lisptc", "oauth");
}

function keyToFileName(serverKey: string): string {
	return `${serverKey.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;
}

export class FileOAuthStore implements OAuthStore {
	constructor(private readonly dir?: string) {}

	private base(): string {
		return this.dir ?? defaultOAuthDir();
	}

	private file(serverKey: string): string {
		return join(this.base(), keyToFileName(serverKey));
	}

	async load(serverKey: string): Promise<OAuthRecord | undefined> {
		try {
			return JSON.parse(await readFile(this.file(serverKey), "utf8"));
		} catch {
			return undefined;
		}
	}

	async save(serverKey: string, record: OAuthRecord): Promise<void> {
		await mkdir(this.base(), { recursive: true, mode: 0o700 });
		await writeFile(this.file(serverKey), JSON.stringify(record), {
			mode: 0o600,
		});
	}

	async clear(serverKey: string): Promise<void> {
		await rm(this.file(serverKey), { force: true });
	}
}

export class MemoryOAuthStore implements OAuthStore {
	private readonly records = new Map<string, OAuthRecord>();

	async load(serverKey: string): Promise<OAuthRecord | undefined> {
		return this.records.get(serverKey);
	}

	async save(serverKey: string, record: OAuthRecord): Promise<void> {
		this.records.set(serverKey, record);
	}

	async clear(serverKey: string): Promise<void> {
		this.records.delete(serverKey);
	}
}
