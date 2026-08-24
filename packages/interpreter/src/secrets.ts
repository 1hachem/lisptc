/*
 * Secret registry for Lisptc.
 *
 * A host-supplied key→value store of secrets. Keys (and descriptions) are
 * listable by the LLM via `(secrets)`; values are read with `(secret key)` as a
 * tainted `Secret` string that prints redacted and is only revealed when
 * serialized into an outgoing call (see lispToJson in src/mcp.ts). The `Secret`
 * taint type and its string-primitive propagation live in src/lisp.ts (they are
 * language machinery); this module owns the *registry* and installs the two
 * built-ins on top of it.
 *
 * Like the MCP integration, this is an opt-in extension: pass
 * `secretsExtension()` in `InterpOptions.extensions`. The backing store is an
 * interface (`SecretsStore`) so a host can swap the default process.env-seeded
 * in-memory store (`EnvSecretsStore`) for another source (a vault client, a
 * remote fetch, …) without touching the built-ins. See devdocs/secrets.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as dotenv from "dotenv";
import { z } from "zod";
import {
	Cell,
	EvalException,
	type Interp,
	type InterpExtension,
	type List,
	Secret,
} from "./lisp.ts";

// A host-supplied secret: a bare value, or a value plus a description shown by
// `(secrets)`.
export type SecretSpec = string | { value: string; description?: string };

// Required prefix for every registry key; kept as part of the key. See
// devdocs/secrets.md.
export const SECRET_ENV_PREFIX = "REPL_";

// A string argument. Local to this module (mirrors mcp.ts defining its own arg
// schemas) so the built-ins here don't widen the interpreter's public API.
const zString = z.custom<string>(
	(x) => typeof x === "string",
	"string expected",
);

// The backing store behind `(secret …)` / `(secrets)`. Values stay hidden from
// listing; only `get` exposes a value (to build the tainted `Secret`). Swap the
// implementation to source secrets from somewhere other than process.env.
export interface SecretsStore {
	// The value + description for `key`, or undefined if unknown.
	get(key: string): { value: string; description: string } | undefined;
	// All `(key, description)` pairs, in a stable order (values hidden).
	list(): Array<[string, string]>;
	// Merge host-supplied secrets in (later wins). Implementations decide which
	// keys they accept — the default enforces the `REPL_` prefix.
	set(record: Record<string, SecretSpec>): void;
}

// The default store: an in-memory registry seeded from `REPL_*` environment
// variables at construction, accepting only `REPL_`-prefixed keys thereafter.
export class EnvSecretsStore implements SecretsStore {
	private readonly secrets = new Map<
		string,
		{ value: string; description: string }
	>();

	constructor(env: NodeJS.ProcessEnv = process.env) {
		for (const [name, value] of Object.entries(env))
			if (value !== undefined && name.startsWith(SECRET_ENV_PREFIX))
				this.secrets.set(name, { value, description: "" });
	}

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

// Load `REPL_*` secrets from a `.env`-style file into `store`; returns the parsed
// entries (so a host can persist them). Throws if the file cannot be read.
export function loadSecretsFromFile(
	store: SecretsStore,
	path: string,
): Record<string, string> {
	const record = dotenv.parse(readFileSync(path));
	store.set(record);
	return record;
}

// Environment variable naming the `.env`-style secrets file to auto-load.
const SECRETS_FILE_ENV = "LISPTC_SECRETS_FILE";

// Find the nearest `.env`, searching upward from `start`. This matters because a
// workspace script runs with cwd set to the package dir (e.g. `pnpm repl` runs
// in packages/repl), so a project-root `.env` is only found by walking up.
function findEnvFileUpwards(start: string): string | undefined {
	let dir = start;
	for (;;) {
		const candidate = join(dir, ".env");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return undefined; // reached the filesystem root
		dir = parent;
	}
}

// Seed `store` from a `.env` file, choosing the path in order: an explicit
// `path`, else $LISPTC_SECRETS_FILE, else the nearest `.env` searching up from
// the launch directory (INIT_CWD under a package-manager script, else cwd). A
// missing default file is silently ignored; a missing *explicitly-named* file
// warns. Returns the loaded entries. This is the addon's single "load from a
// file on disk" entry point, so a host (a REPL) never resolves paths itself.
export function loadSecretsFromEnvFile(
	store: SecretsStore,
	path?: string,
): Record<string, string> {
	const explicit = (path ?? process.env[SECRETS_FILE_ENV]) || undefined;
	const file =
		explicit ?? findEnvFileUpwards(process.env.INIT_CWD || process.cwd());
	if (!file) return {}; // no `.env` anywhere up the tree — fine
	try {
		return loadSecretsFromFile(store, file);
	} catch {
		// A missing/unreadable file is fine unless it was named explicitly.
		if (explicit)
			console.error(`warning: could not read secrets file ${explicit}`);
		return {};
	}
}

export interface SecretsOptions {
	// Backing store; defaults to a fresh env-seeded `EnvSecretsStore`. Pass one to
	// keep the registry across interp resets (a host holds it and injects into it
	// via `store.set`) or to source secrets from somewhere other than the env.
	store?: SecretsStore;
	// Also seed from a `.env` file: `true` uses $LISPTC_SECRETS_FILE or the
	// nearest `.env` up from the launch directory; a string uses that exact path.
	envFile?: boolean | string;
}

// The secrets addon: it installs the `(secret)` / `(secrets)` built-ins over a
// store and, when `envFile` is set, seeds that store from a `.env` file — so
// loading lives here, not in the host. This IS the addon; a host just passes it
// to `InterpOptions.extensions` (holding `options.store` if it needs to inject
// more secrets or keep them across resets). Env-var secrets (`REPL_*`) are
// seeded by the default `EnvSecretsStore`; the `.env` file is loaded here once,
// when the extension is built.
export function secretsExtension(
	options: SecretsOptions = {},
): InterpExtension {
	const store = options.store ?? new EnvSecretsStore();
	if (options.envFile)
		loadSecretsFromEnvFile(
			store,
			options.envFile === true ? undefined : options.envFile,
		);
	return (interp: Interp): void => registerSecrets(interp, store);
}

export function registerSecrets(interp: Interp, store: SecretsStore): void {
	interp.def(
		"secrets",
		0,
		"(secrets)",
		"Return an alist of (key . description) for every available secret. Values are hidden — read one with `(secret key)`.",
		z.tuple([]),
		() => {
			let list: List = null;
			const entries = store.list();
			for (let i = entries.length - 1; i >= 0; i--) {
				const [key, description] = entries[i];
				list = new Cell(new Cell(key, description), list);
			}
			return list;
		},
	);

	interp.def(
		"secret",
		1,
		"(secret key)",
		"Return the secret stored under `key` as a tainted string: every text function works on it and the taint follows into the result, but it always prints redacted (as #<secret:key>) and is only revealed when passed into a call such as an MCP tool or `:headers`. Errors if `key` is unknown.",
		z.tuple([zString]),
		([key]) => {
			const entry = store.get(key);
			if (entry === undefined)
				throw new EvalException("unknown secret", key, false);
			return new Secret(entry.value, [key]);
		},
	);
}
