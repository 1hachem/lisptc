import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { replEnv } from "@repo/env/repl";
import { filePrompt } from "@repo/shared/host-node";
import * as dotenv from "dotenv";
import {
	MapSecretsStore,
	SECRET_ENV_PREFIX,
	type SecretsHost,
	type SecretsStore,
} from "./ports.ts";

export interface EnvSecretsOptions {
	env?: NodeJS.ProcessEnv;
	envFile?: boolean | string;
}

export function envSecretsStore(options: EnvSecretsOptions = {}): SecretsStore {
	const store = new MapSecretsStore();
	// biome-ignore lint/style/noProcessEnv: the store scans for every REPL_*-prefixed name, so no typed env module can enumerate them
	const env = options.env ?? process.env;
	for (const [name, value] of Object.entries(env))
		if (value !== undefined && name.startsWith(SECRET_ENV_PREFIX))
			store.set({ [name]: value });
	if (options.envFile)
		loadSecretsFromEnvFile(
			store,
			options.envFile === true ? undefined : options.envFile,
		);
	return store;
}

export function loadSecretsFromFile(
	store: SecretsStore,
	path: string,
): Record<string, string> {
	const record = dotenv.parse(readFileSync(path));
	store.set(record);
	return record;
}

function findEnvFileUpwards(start: string): string | undefined {
	let dir = start;
	for (;;) {
		const candidate = join(dir, ".env");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

export function loadSecretsFromEnvFile(
	store: SecretsStore,
	path?: string,
): Record<string, string> {
	const explicit = (path ?? replEnv.LISPTC_SECRETS_FILE) || undefined;
	const file =
		explicit ?? findEnvFileUpwards(replEnv.INIT_CWD || process.cwd());
	if (!file) return {};
	try {
		return loadSecretsFromFile(store, file);
	} catch {
		if (explicit)
			console.error(`warning: could not read secrets file ${explicit}`);
		return {};
	}
}

const secretsPrompt = filePrompt(new URL("./secrets.ptc", import.meta.url));

export function secretsHostFor(options: EnvSecretsOptions = {}): SecretsHost {
	return { store: envSecretsStore(options), prompt: secretsPrompt };
}

export const secretsHost: SecretsHost = {
	get store(): SecretsStore {
		return envSecretsStore();
	},
	prompt: secretsPrompt,
};
