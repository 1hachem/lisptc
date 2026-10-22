export function assert(x: boolean, message?: string): asserts x {
	if (!x) throw new Error(`Assertion Failure: ${message || ""}`);
}

export class Cell {
	constructor(
		public car: unknown,
		public cdr: unknown,
	) {}

	toString(): string {
		return `(${this.car} . ${this.cdr})`;
	}

	get length(): number {
		return foldl(0, this, (i, _) => i + 1);
	}
}

export type List = Cell | null;

export function foldl<T>(x: T, j: List, fn: (x: T, y: unknown) => T): T {
	while (j !== null) {
		x = fn(x, j.car);
		j = j.cdr as List;
	}
	return x;
}

export function mapcar(j: List, fn: (x: unknown) => unknown): List {
	if (j === null) return null;
	const a = fn(j.car);
	let d = j.cdr;
	if (d instanceof Cell) d = mapcar(d, fn);
	if (Object.is(j.car, a) && Object.is(j.cdr, d)) return j;
	return new Cell(a, d);
}

export class Sym {
	constructor(public readonly name: string) {}

	toString(): string {
		return this.name;
	}

	get isInterned(): boolean {
		return symTable[this.name] === this;
	}
}

export class Keyword extends Sym {}

export function isSpecialForm(x: unknown): boolean {
	return x instanceof Keyword;
}

export class LispKeyword {
	constructor(public readonly name: string) {}

	toString(): string {
		return `:${this.name}`;
	}
}

const keywordLiteralTable: { [key: string]: LispKeyword } = {};

export function newLispKeyword(name: string): LispKeyword {
	let k = keywordLiteralTable[name];
	if (k === undefined) {
		k = new LispKeyword(name);
		keywordLiteralTable[name] = k;
	}
	return k;
}

const symTable: { [key: string]: Sym } = {};

export function newSym(name: string, isKeyword = false): Sym {
	let result = symTable[name];
	assert(result === undefined || !isKeyword, name);
	if (result === undefined) {
		result = isKeyword ? new Keyword(name) : new Sym(name);
		symTable[name] = result;
	}
	return result;
}

function newKeyword(name: string): Keyword {
	return newSym(name, true);
}

export const backQuoteSym = newSym("`");
export const commaAtSym = newSym(",@");
export const commaSym = newSym(",");
export const dotSym = newSym(".");
export const leftParenSym = newSym("(");
export const rightParenSym = newSym(")");
export const singleQuoteSym = newSym("'");

export const appendSym = newSym("append");
export const catchSym = newSym("catch");
export const consSym = newSym("cons");
export const listSym = newSym("list");
export const keySym = newSym("&key");
export const restSym = newSym("&rest");
export const unquoteSym = newSym("unquote");
export const unquoteSplicingSym = newSym("unquote-splicing");

export const condSym = newKeyword("cond");
export const lambdaSym = newKeyword("lambda");
export const macroSym = newKeyword("macro");
export const prognSym = newKeyword("progn");
export const quasiquoteSym = newKeyword("quasiquote");
export const quoteSym = newKeyword("quote");
export const setqSym = newKeyword("setq");
export const trySym = newKeyword("try");

export const EndOfFile = { toString: () => "EOF" };

export const Unspecified = { toString: () => "#<unspecified>" };

export function arrayToList(arr: unknown[]): List {
	let list: List = null;
	for (let i = arr.length - 1; i >= 0; i--) list = new Cell(arr[i], list);
	return list;
}

export function listToArray(list: List): unknown[] {
	const out: unknown[] = [];
	for (let j = list; j !== null; j = j.cdr as List) out.push(j.car);
	return out;
}

export function jsonToLisp(x: unknown): unknown {
	if (x === null || x === undefined) return null;
	if (x === true) return true;
	if (x === false) return null;
	if (typeof x === "number" || typeof x === "bigint") return x;
	if (typeof x === "string") return x;
	if (Array.isArray(x)) return arrayToList(x.map(jsonToLisp));
	if (typeof x === "object")
		return arrayToList(
			Object.entries(x as Record<string, unknown>).map(
				([k, v]) => new Cell(k, jsonToLisp(v)),
			),
		);
	return String(x);
}

const JSON_FALSE = newLispKeyword("false");
const EMPTY_ARRAY = newLispKeyword("[]");
const EMPTY_OBJECT = newLispKeyword("{}");

function properItems(list: Cell): unknown[] {
	const items: unknown[] = [];
	let j: unknown = list;
	for (; j instanceof Cell; j = j.cdr) items.push(j.car);
	if (j !== null) throw new TypeError("a dotted pair has no JSON form");
	return items;
}

function isPlist(items: unknown[]): boolean {
	return (
		items.length % 2 === 0 &&
		items.every((item, i) => i % 2 === 1 || item instanceof LispKeyword)
	);
}

function isAlist(items: unknown[]): items is Cell[] {
	return items.every(
		(item) => item instanceof Cell && typeof item.car === "string",
	);
}

function writesAsArray(items: unknown[]): boolean {
	return items[0] !== EMPTY_ARRAY && !isPlist(items) && !isAlist(items);
}

export function exactJsonToLisp(x: unknown): unknown {
	if (x === null) return null;
	if (x === true) return true;
	if (x === false) return JSON_FALSE;
	if (typeof x === "number" || typeof x === "string") return x;
	if (Array.isArray(x)) {
		if (x.length === 0) return EMPTY_ARRAY;
		const items = x.map(exactJsonToLisp);
		const list = arrayToList(items);
		return writesAsArray(items) ? list : new Cell(EMPTY_ARRAY, list);
	}
	if (typeof x === "object") {
		const entries = Object.entries(x as Record<string, unknown>);
		if (entries.length === 0) return EMPTY_OBJECT;
		return arrayToList(
			entries.map(([k, v]) => new Cell(k, exactJsonToLisp(v))),
		);
	}
	throw new TypeError(`${String(x)} is not JSON`);
}

function objectOf(entries: [string, unknown][]): Record<string, unknown> {
	const seen = new Set<string>();
	for (const [key] of entries) {
		if (seen.has(key))
			throw new TypeError(`key "${key}" appears twice in one object`);
		seen.add(key);
	}
	return Object.fromEntries(entries);
}

export function lispToJson(x: unknown): unknown {
	if (x === null || x === true || typeof x === "string") return x;
	if (typeof x === "number") {
		if (!Number.isFinite(x)) throw new TypeError(`${x} has no JSON form`);
		return x;
	}
	if (typeof x === "bigint") {
		if (!Number.isSafeInteger(Number(x)))
			throw new TypeError(`${x} is too large for JSON`);
		return Number(x);
	}
	if (x === JSON_FALSE) return false;
	if (x === EMPTY_ARRAY) return [];
	if (x === EMPTY_OBJECT) return {};
	if (x instanceof LispKeyword) return x.name;
	if (!(x instanceof Cell))
		throw new TypeError(`${String(x)} has no JSON form`);
	const items = properItems(x);
	if (items[0] === EMPTY_ARRAY) return items.slice(1).map(lispToJson);
	if (isPlist(items)) {
		const entries: [string, unknown][] = [];
		for (let i = 0; i < items.length; i += 2)
			entries.push([(items[i] as LispKeyword).name, lispToJson(items[i + 1])]);
		return objectOf(entries);
	}
	if (isAlist(items))
		return objectOf(
			items.map((pair) => [pair.car as string, lispToJson(pair.cdr)]),
		);
	return items.map(lispToJson);
}
