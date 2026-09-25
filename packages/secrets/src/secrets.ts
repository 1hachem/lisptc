import {
	compare,
	isNumeric,
	type Numeric,
	quotient,
	ZERO,
} from "@repo/interpreter/arith";
import { EvalException } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import { Cell, type List } from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import { zList } from "@repo/interpreter/schema";
import {
	type InterpExtension,
	type SessionHooks,
	slot,
} from "@repo/interpreter/session";
import type { ToJson } from "@repo/interpreter/types";
import { z } from "zod";
import type { SecretsHost, SecretsStore } from "./ports.ts";

const zString = z.custom<string>(
	(x) => typeof x === "string",
	"string expected",
);
const zNumeric = z.custom<Numeric>(isNumeric, "not a number");

const zStringLike = z.custom<string | Secret>(
	(x) => typeof x === "string" || x instanceof Secret,
	"string expected",
);

export interface SecretsExtension extends InterpExtension {
	readonly store: SecretsStore;
}

export const secretsSlot = slot<SecretsStore>("secrets");

export function secretsExtension(host: SecretsHost): SecretsExtension {
	return Object.assign(
		(interp: Interp): void => registerSecrets(interp, host.store),
		{
			store: host.store,
			prompt: host.prompt(),
			session(hooks: SessionHooks): void {
				hooks.fill(secretsSlot, host.store);
			},
		},
	);
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
