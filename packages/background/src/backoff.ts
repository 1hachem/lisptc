import { EvalException } from "@repo/interpreter/errors";
import {
	arrayToList,
	Cell,
	LispKeyword,
	newLispKeyword,
} from "@repo/interpreter/objects";

const BACKOFF_KINDS = ["constant", "linear", "exponential"] as const;

export type BackoffKind = (typeof BACKOFF_KINDS)[number];

export interface Backoff {
	readonly kind: BackoffKind;
	readonly base: number;
	readonly factor: number;
	readonly max?: number;
	readonly jitter: number;
}

const DEFAULT_BASE = 1000;

const DEFAULT_FACTOR = 2;

function isKind(name: string): name is BackoffKind {
	return (BACKOFF_KINDS as readonly string[]).includes(name);
}

function numberOf(what: string, value: unknown): number {
	const n = Number(value);
	if (typeof value !== "string" && Number.isFinite(n) && n >= 0) return n;
	throw new EvalException(`backoff: ${what} is a number of at least 0`, value);
}

export function backoffOf(
	kind: string,
	options: ReadonlyMap<string, unknown>,
): Backoff {
	if (!isKind(kind))
		throw new EvalException(
			"backoff: the kind is :constant, :linear or :exponential",
			kind,
		);
	const base = options.has("base")
		? numberOf(":base", options.get("base"))
		: DEFAULT_BASE;
	const factor = options.has("factor")
		? numberOf(":factor", options.get("factor"))
		: kind === "linear"
			? base
			: DEFAULT_FACTOR;
	const jitter = options.has("jitter")
		? numberOf(":jitter", options.get("jitter"))
		: 0;
	if (jitter > 1)
		throw new EvalException("backoff: :jitter is between 0 and 1", jitter);
	return {
		kind,
		base,
		factor,
		jitter,
		...(options.has("max")
			? { max: numberOf(":max", options.get("max")) }
			: {}),
	};
}

export function delayOf(
	backoff: Backoff,
	attempt: number,
	random: number,
): number {
	const { kind, base, factor, max, jitter } = backoff;
	const raw =
		kind === "constant"
			? base
			: kind === "linear"
				? base + factor * attempt
				: base * factor ** attempt;
	const jittered = raw * (1 + jitter * (2 * random - 1));
	const capped = max === undefined ? jittered : Math.min(jittered, max);
	return Math.max(0, Math.round(capped));
}

export function backoffToLisp(backoff: Backoff): unknown {
	const { kind, base, factor, max, jitter } = backoff;
	return arrayToList([
		newLispKeyword(kind),
		newLispKeyword("base"),
		base,
		newLispKeyword("factor"),
		factor,
		...(max === undefined ? [] : [newLispKeyword("max"), max]),
		newLispKeyword("jitter"),
		jitter,
	]);
}

export function backoffFromLisp(value: unknown): Backoff {
	if (!(value instanceof Cell) || !(value.car instanceof LispKeyword))
		throw new EvalException(
			"a backoff is what (backoff :kind ...) returns",
			value,
		);
	const options = new Map<string, unknown>();
	for (let at: unknown = value.cdr; at instanceof Cell; ) {
		const key = at.car;
		const rest: unknown = at.cdr;
		if (!(key instanceof LispKeyword) || !(rest instanceof Cell))
			throw new EvalException(
				"backoff: options come in :key value pairs",
				value,
			);
		options.set(key.name, rest.car);
		at = rest.cdr;
	}
	return backoffOf(value.car.name, options);
}
