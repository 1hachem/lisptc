import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { replEnv } from "@repo/env/repl";
import * as dotenv from "dotenv";
import { z } from "zod";
import { compare, isNumeric, type Numeric, quotient, ZERO } from "./arith.ts";
import {
	Cell,
	EvalException,
	type Interp,
	type InterpExtension,
	type List,
	str,
	zList,
} from "./lisp.ts";
import { type PromptSection, prompted, promptSection } from "./prompt.ts";
import type { ToJson } from "./types.ts";

export type SecretSpec = string | { value: string; description?: string };

export const SECRET_ENV_PREFIX = "REPL_";

export const SECRETS_PROMPT: PromptSection = promptSection(
	"secrets",
	new URL("./secrets.ptc", import.meta.url),
);

const zString = z.custom<string>(
	(x) => typeof x === "string",
	"string expected",
);
const zNumeric = z.custom<Numeric>(isNumeric, "not a number");

const zStringLike = z.custom<string | Secret>(
	(x) => typeof x === "string" || x instanceof Secret,
	"string expected",
);

export interface SecretsStore {
	get(key: string): { value: string; description: string } | undefined;
	list(): Array<[string, string]>;
	set(record: Record<string, SecretSpec>): void;
}

export class EnvSecretsStore implements SecretsStore {
	private readonly secrets = new Map<
		string,
		{ value: string; description: string }
	>();

	// biome-ignore lint/style/noProcessEnv: the store scans for every REPL_*-prefixed name, so no typed env module can enumerate them
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

export interface SecretsOptions {
	store?: SecretsStore;
	envFile?: boolean | string;
}

export interface SecretsExtension extends InterpExtension {
	readonly store: SecretsStore;
}

export function secretsExtension(
	options: SecretsOptions = {},
): SecretsExtension {
	const store = options.store ?? new EnvSecretsStore();
	if (options.envFile)
		loadSecretsFromEnvFile(
			store,
			options.envFile === true ? undefined : options.envFile,
		);
	return Object.assign(
		prompted(
			(interp: Interp): void => registerSecrets(interp, store),
			[SECRETS_PROMPT],
		),
		{
			store,
		},
	);
}

export function storeOf(extension: InterpExtension): SecretsStore | undefined {
	const carried = (extension as Partial<SecretsExtension>).store;
	return typeof carried?.get === "function" ? carried : undefined;
}

class Secret implements ToJson {
	readonly keys: readonly string[];
	constructor(
		readonly value: string,
		keys: Iterable<string>,
	) {
		this.keys = [...new Set(keys)];
	}
	get length(): number {
		return this.value.length;
	}
	toString(): string {
		return `#<secret:${this.keys.join("+")}>`;
	}
	toJSON(): string {
		return this.value;
	}
}

function secretValue(x: string | Secret): string {
	return x instanceof Secret ? x.value : x;
}

function propagateTaint(
	value: string,
	sources: readonly unknown[],
): string | Secret {
	const keys: string[] = [];
	for (const s of sources) if (s instanceof Secret) keys.push(...s.keys);
	return keys.length > 0 ? new Secret(value, keys) : value;
}

export function registerSecrets(interp: Interp, store: SecretsStore): void {
	interp.prompts.add(SECRETS_PROMPT);
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
		"string",
		1,
		"(string x)",
		'Convert `x` to a string: its printed form, with a string left as itself rather than quoted. `(string 12)` is "12", `(string \'foo)` is "foo", `(string nil)` is "nil". A secret converts to itself, staying tainted.',
		z.tuple([z.unknown()]),
		([x]) => (x instanceof Secret ? x : str(x, false)),
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
