/*
 * Secret registry + taint tracking for Lisptc.
 *
 * A host-supplied key→value store of secrets. Keys (and descriptions) are
 * listable by the LLM via `(secrets)`; values are read with `(secret key)` as a
 * tainted `Secret` string that prints redacted (via its `toString`, which `str`
 * duck-types on) and is revealed only when serialized into an outgoing call
 * (via its `toJSON`, which lispToJson in src/mcp.ts duck-types on — mcp never
 * imports this module; the extensions communicate only through those two JS
 * conventions, mirroring display vs wire form).
 *
 * This module owns the whole taint story: the `Secret` type, plus overrides of
 * the core string primitives (`interp.def` overwrites the global) so a secret
 * flows through them and re-taints every derived string. The Lisp string
 * library resolves those names at call time, so it becomes taint-aware for
 * free. Without this extension no Secret value can exist and the core
 * plain-string primitives are exactly right.
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
import { compare, isNumeric, type Numeric, quotient, ZERO } from "./arith.ts";
import {
	Cell,
	EvalException,
	type Interp,
	type InterpExtension,
	type List,
	zList,
} from "./lisp.ts";
import type { ToJson } from "./types.ts";

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
const zNumeric = z.custom<Numeric>(isNumeric, "not a number");

// A plain string or a tainted secret; used by the string primitives so secrets
// flow through (read with `secretValue`, re-taint with `propagateTaint`).
const zStringLike = z.custom<string | Secret>(
	(x) => typeof x === "string" || x instanceof Secret,
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

// A tainted string: a secret's value, or anything derived from one. Behaves
// like a string but `str` renders it redacted as `#<secret:KEY>` (toString);
// the value is revealed only through the toJSON wire form, which mcp's
// lispToJson honors when serializing an outgoing call. `keys` are the source
// secrets (>1 after combining).
class Secret implements ToJson {
	readonly keys: readonly string[];
	constructor(
		readonly value: string,
		keys: Iterable<string>,
	) {
		this.keys = [...new Set(keys)];
	}
	// Length so the overridden `length` primitive treats a secret like a string.
	get length(): number {
		return this.value.length;
	}
	toString(): string {
		return `#<secret:${this.keys.join("+")}>`;
	}
	// The wire form — the one path that reveals the value.
	toJSON(): string {
		return this.value;
	}
}

// The underlying string of a plain string or a tainted secret.
function secretValue(x: string | Secret): string {
	return x instanceof Secret ? x.value : x;
}

// Re-taint: if any source was a secret, wrap the result as a secret (unioning
// keys); else return the plain string. How the string primitives propagate taint.
function propagateTaint(
	value: string,
	sources: readonly unknown[],
): string | Secret {
	const keys: string[] = [];
	for (const s of sources) if (s instanceof Secret) keys.push(...s.keys);
	return keys.length > 0 ? new Secret(value, keys) : value;
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

	// --- Tainted string primitives -------------------------------------------
	//
	// Overrides of the core built-ins (interp.def overwrites the global, docs
	// included): each accepts a Secret wherever a string is expected, unwraps
	// it for the operation and re-taints the result. The prelude's string
	// library (substring, string-prefix?, …) calls these names, so taint
	// propagates through all of Lisp's string functions for free.
	interp.def(
		"length",
		1,
		"(length x)",
		"Return the length of a list or string.",
		z.tuple([
			z.custom<Cell | string | Secret | null>(
				(x) =>
					x === null ||
					x instanceof Cell ||
					typeof x === "string" ||
					x instanceof Secret,
				"list or string expected",
			),
		]),
		([x]) => (x === null ? ZERO : quotient(x.length, 1)),
	);
	interp.def(
		"stringp",
		1,
		"(stringp x)",
		"Return t if `x` is a string.",
		z.tuple([z.unknown()]),
		([x]) => (typeof x === "string" || x instanceof Secret ? true : null),
	);
	interp.def(
		"eql",
		2,
		"(eql x y)",
		"Return t if `x` and `y` are identical or numerically equal. Alias: `=`.",
		z.tuple([z.unknown(), z.unknown()]),
		([x, y]) => {
			if (x === y) return true;
			if (isNumeric(x) && isNumeric(y) && compare(x, y) === 0) return true;
			// Strings compare by value, so a tainted secret is equal to the
			// plain string it holds (lets string predicates work on secrets).
			const xs = typeof x === "string" || x instanceof Secret;
			const ys = typeof y === "string" || y instanceof Secret;
			if (xs && ys && secretValue(x) === secretValue(y)) return true;
			return null;
		},
	);
	interp.def(
		"char",
		2,
		"(char s i)",
		"Return the character at index `i` of `s` as a one-character string, or nil if `i` is out of range.",
		z.tuple([zStringLike, zNumeric]),
		([s, i]) => {
			const v = secretValue(s);
			const n = Number(i);
			return n >= 0 && n < v.length ? propagateTaint(v[n], [s]) : null;
		},
	);
	interp.def(
		"concat",
		-1,
		"(concat s...)",
		"Concatenate the string arguments into one string. If any argument is a secret, the result is a secret too (its taint is carried through).",
		z.tuple([zList]),
		([rest]) => {
			let out = "";
			const sources: unknown[] = [];
			for (let p = rest; p !== null; p = p.cdr as List) {
				const s = (p as Cell).car;
				if (typeof s !== "string" && !(s instanceof Secret))
					throw new EvalException("not a string", s);
				sources.push(s);
				out += secretValue(s);
			}
			return propagateTaint(out, sources);
		},
	);
	interp.def(
		"string-upcase",
		1,
		"(string-upcase s)",
		"Return `s` with all letters converted to upper case.",
		z.tuple([zStringLike]),
		([s]) => propagateTaint(secretValue(s).toUpperCase(), [s]),
	);
	interp.def(
		"string-downcase",
		1,
		"(string-downcase s)",
		"Return `s` with all letters converted to lower case.",
		z.tuple([zStringLike]),
		([s]) => propagateTaint(secretValue(s).toLowerCase(), [s]),
	);
}
