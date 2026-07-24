/*
 * The S-expression data model: cons cells, symbols, keywords and the
 * interning tables, plus the tiny list helpers the rest of the interpreter
 * is built on.
 */
import { EvalException } from "./exceptions.ts";

// An inefficient substitution of assert statement in Dart
export function assert(x: boolean, message?: string): asserts x {
	if (!x) throw new Error(`Assertion Failure: ${message || ""}`);
}

// Lisp cons cell
export class Cell {
	constructor(
		public car: unknown,
		public cdr: unknown,
	) {}

	toString(): string {
		return `(${this.car} . ${this.cdr})`;
	}

	// Length as a list
	get length(): number {
		return foldl(0, this, (i, _) => i + 1);
	}
}

// Lisp's list
export type List = Cell | null;

// foldl(x, (a b c), fn) => fn(fn(fn(x, a), b), c)
export function foldl<T>(x: T, j: List, fn: (x: T, y: unknown) => T): T {
	while (j !== null) {
		x = fn(x, j.car);
		j = j.cdr as List;
	}
	return x;
}

// mapList((a b c), fn) => (fn(a) fn(b) fn(c)), sharing structure where
// nothing changed. (TS-level; distinct from the prelude's Lisp `mapcar`.)
export function mapList(j: List, fn: (x: unknown) => unknown): List {
	if (j === null) return null;
	const a = fn(j.car);
	let d = j.cdr;
	if (d instanceof Cell) d = mapList(d, fn);
	if (Object.is(j.car, a) && Object.is(j.cdr, d)) return j;
	return new Cell(a, d);
}

// Get cdr of list x as a Cell or null.
export function cdrCell(x: Cell): List {
	const k = x.cdr;
	if (k instanceof Cell) return k;
	else if (k === null) return null;
	else throw new EvalException("proper list expected", x);
}

// Lisp symbol
export class Sym {
	// Construct an uninterned symbol.
	constructor(public readonly name: string) {}

	toString(): string {
		return this.name;
	}

	// Is it interned?
	get isInterned(): boolean {
		return symTable[this.name] === this;
	}
}

// Expression keyword
export class Keyword extends Sym {}

// Self-evaluating keyword literal, e.g. `:query`. Distinct from the special-form
// `Keyword` class above (which subclasses Sym and drives cond/lambda/setq/...).
// A LispKeyword evaluates to itself (like a number or string) and prints with a
// leading colon. Used for ergonomic `(fn :key val ...)` call syntax.
export class LispKeyword {
	// name is stored WITHOUT the leading colon.
	constructor(public readonly name: string) {}

	toString(): string {
		return `:${this.name}`;
	}
}

// Interned keyword literals so that `(eq :a :a)` holds.
const keywordLiteralTable: { [key: string]: LispKeyword } = {};

export function newLispKeyword(name: string): LispKeyword {
	let k = keywordLiteralTable[name];
	if (k === undefined) {
		k = new LispKeyword(name);
		keywordLiteralTable[name] = k;
	}
	return k;
}

// The table of interned symbols
const symTable: { [key: string]: Sym } = {};

// Construct an interned symbol; construct a Keyword if isKeyword holds.
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
export const consSym = newSym("cons");
export const listSym = newSym("list");
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
