/*
 * Lisp <-> JS/JSON value conversion for MCP arguments and results.
 */
import { isNumeric } from "../arith.ts";
import { EvalException } from "../exceptions.ts";
import { Cell, LispKeyword, type List, Sym } from "../sexpr.ts";

export function listToArray(list: List): unknown[] {
	const out: unknown[] = [];
	for (let j = list; j !== null; j = j.cdr as List) out.push(j.car);
	return out;
}

export function arrayToList(arr: unknown[]): List {
	let out: List = null;
	for (let i = arr.length - 1; i >= 0; i--) out = new Cell(arr[i], out);
	return out;
}

// Parse a keyword plist (:k1 v1 :k2 v2 ...) into a Map of name -> raw Lisp value.
export function parsePlist(list: List): Map<string, unknown> {
	const out = new Map<string, unknown>();
	let j = list;
	while (j !== null) {
		const key = j.car;
		const rest = j.cdr as List;
		if (rest === null)
			throw new EvalException(
				"odd-length keyword list; missing value for",
				key,
			);
		const name = keyName(key);
		out.set(name, rest.car);
		j = rest.cdr as List;
	}
	return out;
}

// Extract the string name from a :keyword, symbol, or string key.
function keyName(key: unknown): string {
	if (key instanceof LispKeyword) return key.name;
	if (key instanceof Sym) return key.name;
	if (typeof key === "string") return key;
	throw new EvalException("keyword expected as key", key);
}

// Detect an alist: a proper list whose every element is a (key . value) pair.
function isAlist(x: Cell): boolean {
	for (let j: List = x; j !== null; j = j.cdr as List) {
		const e = j.car;
		if (!(e instanceof Cell)) return false;
		const k = e.car;
		if (
			!(k instanceof Sym || k instanceof LispKeyword || typeof k === "string")
		)
			return false;
	}
	return true;
}

export function lispToJson(x: unknown): unknown {
	if (x === null) return null;
	if (x === true) return true;
	if (typeof x === "string") return x;
	if (typeof x === "bigint") return Number(x);
	if (isNumeric(x)) return x;
	if (x instanceof LispKeyword) return x.name;
	if (x instanceof Sym) return x.name;
	if (x instanceof Cell) {
		if (isAlist(x)) {
			const obj: Record<string, unknown> = {};
			for (let j: List = x; j !== null; j = j.cdr as List) {
				const pair = j.car as Cell;
				obj[keyName(pair.car)] = lispToJson(pair.cdr);
			}
			return obj;
		}
		return listToArray(x).map(lispToJson);
	}
	return String(x);
}

export function jsonToLisp(x: unknown): unknown {
	if (x === null || x === undefined) return null;
	if (x === true) return true;
	if (x === false) return null; // Lisp has only nil for falsity
	if (typeof x === "number" || typeof x === "bigint") return x;
	if (typeof x === "string") return x;
	if (Array.isArray(x)) return arrayToList(x.map(jsonToLisp));
	if (typeof x === "object") {
		const pairs = Object.entries(x as Record<string, unknown>).map(
			([k, v]) => new Cell(k, jsonToLisp(v)),
		);
		return arrayToList(pairs);
	}
	return String(x);
}
