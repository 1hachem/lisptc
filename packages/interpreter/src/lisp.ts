import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import {
	add,
	compare,
	convertToString,
	divide,
	isNumeric,
	multiply,
	type Numeric,
	ONE,
	quotient,
	remainder,
	subtract,
	tryToParse,
	ZERO,
} from "./arith.ts";
import { Channels, MODEL, USER } from "./channels.ts";
import { type Hooks, newHooks, noOpinion } from "./hooks.ts";

function assert(x: boolean, message?: string): asserts x {
	if (!x) throw new Error(`Assertion Failure: ${message || ""}`);
}

let write: (s: string) => void = () => {};
let exit: (n: number) => void = () => {};

export function setWriter(fn: (s: string) => void): (s: string) => void {
	const prev = write;
	write = fn;
	return prev;
}

export function writeOut(s: string): void {
	write(s);
}

export function setExit(fn: (n: number) => void): void {
	exit = fn;
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

function foldl<T>(x: T, j: List, fn: (x: T, y: unknown) => T): T {
	while (j !== null) {
		x = fn(x, j.car);
		j = j.cdr as List;
	}
	return x;
}

function mapcar(j: List, fn: (x: unknown) => unknown): List {
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

class Keyword extends Sym {}

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

const backQuoteSym = newSym("`");
const commaAtSym = newSym(",@");
const commaSym = newSym(",");
const dotSym = newSym(".");
const leftParenSym = newSym("(");
const rightParenSym = newSym(")");
const singleQuoteSym = newSym("'");

const appendSym = newSym("append");
const catchSym = newSym("catch");
const consSym = newSym("cons");
const listSym = newSym("list");
const restSym = newSym("&rest");
const unquoteSym = newSym("unquote");
const unquoteSplicingSym = newSym("unquote-splicing");

const condSym = newKeyword("cond");
const lambdaSym = newKeyword("lambda");
const macroSym = newKeyword("macro");
const prognSym = newKeyword("progn");
const quasiquoteSym = newKeyword("quasiquote");
const quoteSym = newKeyword("quote");
const setqSym = newKeyword("setq");
const trySym = newKeyword("try");

function cdrCell(x: Cell): List {
	const k = x.cdr;
	if (k instanceof Cell) return k;
	else if (k === null) return null;
	else throw new EvalException("proper list expected", x);
}

function ensureNum(x: unknown): Numeric {
	if (isNumeric(x)) return x;
	throw new EvalException("not a number", x);
}

export const zAny = z.unknown();
export const zList = z.custom<List>(
	(x) => x === null || x instanceof Cell,
	"list expected",
);
const zCell = z.custom<Cell>((x) => x instanceof Cell, "cell expected");
const zNumeric = z.custom<Numeric>(isNumeric, "not a number");
const zString = z.custom<string>(
	(x) => typeof x === "string",
	"string expected",
);
const zSym = z.custom<Sym>((x) => x instanceof Sym, "symbol expected");

function parseArgs<T extends z.ZodType>(schema: T, a: unknown[]): z.infer<T> {
	const result = schema.safeParse(a);
	if (result.success) return result.data;
	const issue = result.error.issues[0];
	const index = issue?.path[0];
	throw new EvalException(
		issue?.message ?? "invalid argument",
		typeof index === "number" ? a[index] : a,
	);
}

export type Eval<T = unknown> = Generator<Promise<unknown>, T, unknown>;

abstract class Func {
	constructor(public readonly carity: number) {}

	get arity(): number {
		return this.carity < 0 ? -this.carity : this.carity;
	}

	get hasRest(): boolean {
		return this.carity < 0;
	}

	get fixedArgs(): number {
		return this.carity < 0 ? -this.carity - 1 : this.carity;
	}

	makeFrame(arg: List): unknown[] {
		const frame = new Array(this.arity);
		const n = this.fixedArgs;
		let i = 0;
		for (; i < n && arg !== null; i++) {
			frame[i] = arg.car;
			arg = cdrCell(arg);
		}
		if (i !== n || (arg !== null && !this.hasRest))
			throw new EvalException("arity not matched", this);
		if (this.hasRest) frame[n] = arg;
		return frame;
	}
}

abstract class DefinedFunc extends Func {
	constructor(
		carity: number,
		public readonly body: List,
	) {
		super(carity);
	}
}

type FuncFactory = (carity: number, body: List, env: List) => DefinedFunc;

class Macro extends DefinedFunc {
	toString(): string {
		return `#<macro:${this.carity}:${str(this.body)}>`;
	}

	*expandWith(interp: Interp, arg: List): Eval {
		const frame = this.makeFrame(arg);
		const env = new Cell(frame, null);
		let x: unknown = null;
		for (let j = this.body; j !== null; j = cdrCell(j))
			x = yield* interp.evalGen(j.car, env);
		return x;
	}

	static make(carity: number, body: List, env: List): DefinedFunc {
		assert(env === null);
		return new Macro(carity, body);
	}
}

class Lambda extends DefinedFunc {
	toString(): string {
		return `#<lambda:${this.carity}:${str(this.body)}>`;
	}

	static make(carity: number, body: List, env: List): DefinedFunc {
		assert(env === null);
		return new Lambda(carity, body);
	}
}

class Closure extends DefinedFunc {
	constructor(
		carity: number,
		body: List,
		readonly env: List,
	) {
		super(carity, body);
	}

	static makeFrom(x: Lambda, env: List) {
		return new Closure(x.carity, x.body, env);
	}

	toString(): string {
		return `#<closure:${this.carity}:${str(this.body)}>`;
	}

	static make(carity: number, body: List, env: List): DefinedFunc {
		return new Closure(carity, body, env);
	}
}

type BuiltInFuncBody = (frame: unknown[]) => unknown;
type BuiltInFuncGen = (frame: unknown[]) => Eval;

type BuiltInKind = "plain" | "generator" | "promise";

class BuiltInFunc extends Func {
	constructor(
		private readonly name: string,
		carity: number,
		private readonly body: BuiltInFuncBody | BuiltInFuncGen,
		readonly kind: BuiltInKind = "plain",
	) {
		super(carity);
	}

	toString(): string {
		return `#<${this.name}:${this.carity}>`;
	}

	call(frame: unknown[]): unknown {
		try {
			return (this.body as BuiltInFuncBody)(frame);
		} catch (ex) {
			throw this.failure(ex, frame);
		}
	}

	*settle(promise: Promise<unknown>): Eval {
		try {
			return yield promise;
		} catch (ex) {
			if (ex instanceof EvalException || ex instanceof LoopSignal) throw ex;
			throw new EvalException(
				`${this.name} failed`,
				ex instanceof Error ? ex.message : String(ex),
				false,
			);
		}
	}

	*callGen(frame: unknown[]): Eval {
		try {
			return yield* (this.body as BuiltInFuncGen)(frame);
		} catch (ex) {
			throw this.failure(ex, frame);
		}
	}

	private failure(ex: unknown, frame: unknown[]): unknown {
		if (ex instanceof EvalException || ex instanceof LoopSignal) return ex;
		return new EvalException(`${ex} -- ${this.name}`, frame);
	}
}

export function callableKind(x: unknown): "function" | "macro" | undefined {
	if (x instanceof Macro) return "macro";
	if (x instanceof Func) return "function";
	return undefined;
}

export function callableArity(x: unknown): Arity | undefined {
	if (!(x instanceof Func)) return undefined;
	return { min: x.fixedArgs, max: x.hasRest ? undefined : x.arity };
}

class Arg {
	constructor(
		public readonly level: number,
		public readonly offset: number,
		public readonly symbol: Sym,
	) {}

	toString(): string {
		return `#${this.level}:${this.offset}:${this.symbol}`;
	}

	setValue(x: unknown, env: Cell): void {
		for (let i = 0; i < this.level; i++) env = env.cdr as Cell;
		(env.car as unknown[])[this.offset] = x;
	}

	getValue(env: Cell): unknown {
		for (let i = 0; i < this.level; i++) env = env.cdr as Cell;
		return (env.car as unknown[])[this.offset];
	}
}

export class EvalException extends Error {
	readonly trace: string[] = [];
	readonly value: unknown;

	constructor(msg: string, x: unknown, quoteString = true) {
		super(`${msg}: ${str(x, quoteString)}`);
		this.value = x;
	}

	toString(): string {
		let s = `EvalException: ${this.message}`;
		for (const line of this.trace) s += `\n\t${line}`;
		return s;
	}
}

class LoopSignal {
	constructor(readonly value: unknown) {}
}

class NotVariableException extends EvalException {
	constructor(x: unknown) {
		super("variable expected", x);
	}
}

class FormatException extends Error {}

class SyntaxException extends EvalException {
	constructor(
		readonly reason: string,
		readonly line: number,
	) {
		super("syntax error", `${reason} at ${line}`, false);
	}
}

export const EndOfFile = { toString: () => "EOF" };

export const Unspecified = { toString: () => "#<unspecified>" };

export interface DocArg {
	name: string;
	type: string;
	required: boolean;
	description?: string;
}

export interface Arity {
	min: number;
	max?: number;
}

export interface Doc {
	signature: string;
	doc: string;
	args?: DocArg[];
}

const specialFormDocs: Record<string, Doc> = {
	quote: {
		signature: "(quote x)",
		doc: "Return `x` unevaluated. `'x` is shorthand.",
	},
	progn: {
		signature: "(progn expr...)",
		doc: "Evaluate the expressions in order; return the last value.",
	},
	cond: {
		signature: "(cond (test expr...)...)",
		doc: "Evaluate each `test` in turn; for the first non-nil one, evaluate its body and return the last value (or the test's value if the body is empty). Returns nil if no test passes.",
	},
	setq: {
		signature: "(setq name value...)",
		doc: "Assign each `value` to the (global or lexical) variable `name`; return the last value.",
	},
	lambda: {
		signature: "(lambda (arg...) body...)",
		doc: "Create an anonymous function. The argument list may end with `&rest name` to collect remaining arguments as a list.",
	},
	macro: {
		signature: "(macro (arg...) body...)",
		doc: "Create a macro (only at the top level). Prefer `defmacro`.",
	},
	try: {
		signature: "(try body-form (catch (var) handler-form...))",
		doc: "Evaluate body-form. If it signals a catchable error (a built-in runtime error or a user `(error value)` call), bind var to the error's value and evaluate the handler forms, returning the last one; with no error, returns body-form's value directly. Does not catch break/return loop signals.",
	},
	t: { signature: "t", doc: "The canonical true value." },
	nil: { signature: "nil", doc: "The empty list / false value." },
};

function listToStrings(list: List): string[] {
	const out: string[] = [];
	for (let c = list; c !== null; c = c.cdr as Cell | null) out.push(str(c.car));
	return out;
}

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

export type InterpExtension = (interp: Interp) => void;

export interface InterpOptions {
	extensions?: InterpExtension[];
}

export class Interp {
	private readonly globals: Map<Sym, unknown> = new Map();

	readonly hooks: Hooks = newHooks();

	readonly channels: Channels = new Channels();

	readonly importStack: string[] = [];
	private readonly importing: Set<string> = new Set();

	private readonly docTable: Map<string, Doc> = new Map();

	globalNames(): string[] {
		return [...this.globals.keys()].map((s) => s.name);
	}

	docs(): Map<string, Doc> {
		return new Map([...Object.entries(specialFormDocs), ...this.docTable]);
	}

	arityOf(name: string): Arity | undefined {
		const value = this.globals.get(newSym(name));
		if (!(value instanceof Func)) return undefined;
		return {
			min: value.fixedArgs,
			max: value.hasRest ? undefined : value.arity,
		};
	}

	constructor(options: InterpOptions = {}) {
		this.channels.on(USER, (d) => write(d.text));
		this.def(
			"car",
			1,
			"(car list)",
			"Return the first element of `list`, or nil for nil.",
			z.tuple([zList]),
			([x]) => (x === null ? null : x.car),
		);
		this.def(
			"cdr",
			1,
			"(cdr list)",
			"Return the rest of `list` after the first element, or nil for nil.",
			z.tuple([zList]),
			([x]) => (x === null ? null : x.cdr),
		);
		this.def(
			"cons",
			2,
			"(cons x y)",
			"Return a new cons cell with `x` as car and `y` as cdr.",
			z.tuple([zAny, zAny]),
			([x, y]) => new Cell(x, y),
		);
		this.def(
			"atom",
			1,
			"(atom x)",
			"Return t if `x` is not a cons cell (i.e. not a non-empty list).",
			z.tuple([zAny]),
			([x]) => (x instanceof Cell ? null : true),
		);
		this.def(
			"eq",
			2,
			"(eq x y)",
			"Return t if `x` and `y` are the same object (identity).",
			z.tuple([zAny, zAny]),
			([x, y]) => (Object.is(x, y) ? true : null),
		);

		this.def(
			"list",
			-1,
			"(list x...)",
			"Return a new list of the given elements.",
			z.tuple([zList]),
			([rest]) => rest,
		);
		this.def(
			"rplaca",
			2,
			"(rplaca cell x)",
			"Destructively set the car of `cell` to `x`; return `x`. Alias: `setcar`.",
			z.tuple([zCell, zAny]),
			([cell, x]) => {
				cell.car = x;
				return x;
			},
		);
		this.def(
			"rplacd",
			2,
			"(rplacd cell x)",
			"Destructively set the cdr of `cell` to `x`; return `x`. Alias: `setcdr`.",
			z.tuple([zCell, zAny]),
			([cell, x]) => {
				cell.cdr = x;
				return x;
			},
		);
		this.def(
			"length",
			1,
			"(length x)",
			"Return the length of a list or string.",
			z.tuple([
				z.custom<Cell | string | null>(
					(x) => x === null || x instanceof Cell || typeof x === "string",
					"list or string expected",
				),
			]),
			([x]) => (x === null ? ZERO : quotient(x.length, 1)),
		);
		this.def(
			"stringp",
			1,
			"(stringp x)",
			"Return t if `x` is a string.",
			z.tuple([zAny]),
			([x]) => (typeof x === "string" ? true : null),
		);
		this.def(
			"numberp",
			1,
			"(numberp x)",
			"Return t if `x` is a number.",
			z.tuple([zAny]),
			([x]) => (isNumeric(x) ? true : null),
		);

		this.def(
			"eql",
			2,
			"(eql x y)",
			"Return t if `x` and `y` are identical or numerically equal. Alias: `=`.",
			z.tuple([zAny, zAny]),
			([x, y]) => {
				if (x === y) return true;
				if (isNumeric(x) && isNumeric(y) && compare(x, y) === 0) return true;
				return null;
			},
		);

		this.def(
			"<",
			2,
			"(< x y)",
			"Return t if `x` is numerically less than `y`.",
			z.tuple([zNumeric, zNumeric]),
			([x, y]) => (compare(x, y) < 0 ? true : null),
		);

		this.def(
			"%",
			2,
			"(% x y)",
			"Return the remainder of `x` divided by `y`. Alias: `rem`.",
			z.tuple([zNumeric, zNumeric]),
			([x, y]) => remainder(x, y),
		);

		this.def(
			"mod",
			2,
			"(mod x y)",
			"Return `x` modulo `y` (result has the sign of `y`).",
			z.tuple([zNumeric, zNumeric]),
			([x, y]) => {
				const q = remainder(x, y);
				return compare(multiply(x, y), ZERO) < 0 ? add(q, y) : q;
			},
		);

		this.def(
			"+",
			-1,
			"(+ x...)",
			"Return the sum of the arguments (0 with no arguments).",
			z.tuple([zList]),
			([rest]) => foldl(ZERO, rest, (i, j) => add(i as Numeric, ensureNum(j))),
		);

		this.def(
			"*",
			-1,
			"(* x...)",
			"Return the product of the arguments (1 with no arguments).",
			z.tuple([zList]),
			([rest]) =>
				foldl(ONE, rest, (i, j) => multiply(i as Numeric, ensureNum(j))),
		);

		this.def(
			"-",
			-2,
			"(- x y...)",
			"Subtract the rest from `x`; with one argument, negate it.",
			z.tuple([zNumeric, zList]),
			([x, rest]) =>
				rest === null
					? -x
					: foldl<Numeric>(x, rest, (i, j) => subtract(i, ensureNum(j))),
		);

		this.def(
			"/",
			-3,
			"(/ x y...)",
			"Divide `x` by the remaining arguments.",
			z.tuple([zNumeric, zNumeric, zList]),
			([x, y, rest]) =>
				foldl(divide(x, y), rest, (i, j) => divide(i as Numeric, ensureNum(j))),
		);

		this.def(
			"truncate",
			-2,
			"(truncate x [y])",
			"Return `x` (or `x`/`y`) truncated toward zero to an integer.",
			z.tuple([zNumeric, zList]),
			([x, rest]) => {
				if (rest === null) {
					return quotient(x, ONE);
				} else if (rest.cdr === null) {
					return quotient(x, ensureNum(rest.car));
				} else {
					throw "one or two arguments expected";
				}
			},
		);

		this.def(
			"echo",
			-1,
			"(echo x...)",
			"Print the arguments, separated by spaces and followed by a newline: strings as they are, everything else in re-readable form. `(echo)` alone prints a blank line. Returns an unspecified value, so the REPL reports nothing for a step that ends in an echo — what was printed IS the report.",
			z.tuple([zList]),
			([rest]) => {
				this.say(`${echoText(rest)}\n`);
				return Unspecified;
			},
		);
		this.def(
			"doc",
			-1,
			"(doc [name])",
			"With a symbol, print that binding's signature and description; return the symbol (nil if undocumented). With no argument, print every documented name.",
			z.tuple([zList]),
			([rest]) => {
				const docs = this.docs();
				if (rest === null) {
					for (const key of [...docs.keys()].sort()) this.say(`${key}\n`);
					return true;
				}
				const name = rest.car;
				if (!(name instanceof Sym))
					throw new EvalException("symbol expected", name);
				const entry = docs.get(name.name);
				if (entry === undefined) {
					this.say(`${name.name}: undocumented\n`);
					return null;
				}
				const body = entry.doc
					.split("\n")
					.map((line) => (line ? `  ${line}` : line))
					.join("\n");
				this.say(`${entry.signature}\n${body}\n`);
				return name;
			},
		);

		const gensymCounter = newSym("*gensym-counter*");
		this.globals.set(gensymCounter, ONE);
		this.docTable.set("*gensym-counter*", {
			signature: "*gensym-counter*",
			doc: "Counter used by `gensym` to name fresh symbols.",
		});
		this.def(
			"gensym",
			0,
			"(gensym)",
			"Return a new uninterned symbol (G1, G2, ...).",
			z.tuple([]),
			() => {
				const i = this.globals.get(gensymCounter) as Numeric;
				this.globals.set(gensymCounter, add(i, ONE));
				return new Sym(`G${i}`);
			},
		);

		this.def(
			"make-symbol",
			1,
			"(make-symbol name)",
			"Return a new uninterned symbol named `name`.",
			z.tuple([zString]),
			([name]) => new Sym(name),
		);
		this.def(
			"intern",
			1,
			"(intern name)",
			"Return the interned symbol named `name`.",
			z.tuple([zString]),
			([name]) => newSym(name),
		);
		this.def(
			"symbol-name",
			1,
			"(symbol-name sym)",
			"Return the name of `sym` as a string.",
			z.tuple([zSym]),
			([sym]) => sym.name,
		);

		this.def(
			"char",
			2,
			"(char s i)",
			"Return the character at index `i` of `s` as a one-character string, or nil if `i` is out of range.",
			z.tuple([zString, zNumeric]),
			([s, i]) => {
				const n = Number(i);
				return n >= 0 && n < s.length ? s[n] : null;
			},
		);
		this.def(
			"concat",
			-1,
			"(concat s...)",
			"Concatenate the string arguments into one string.",
			z.tuple([zList]),
			([rest]) => {
				let out = "";
				for (let p = rest; p !== null; p = p.cdr as List) {
					const s = (p as Cell).car;
					if (typeof s !== "string") throw new EvalException("not a string", s);
					out += s;
				}
				return out;
			},
		);
		this.def(
			"string",
			1,
			"(string x)",
			'Convert `x` to a string: its printed form, with a string left as itself rather than quoted. `(string 12)` is "12", `(string \'foo)` is "foo", `(string nil)` is "nil". Numbers keep the exact/inexact distinction, so `(string 3.0)` is "3.0", not "3".',
			z.tuple([zAny]),
			([x]) => str(x, false),
		);
		this.def(
			"string-upcase",
			1,
			"(string-upcase s)",
			"Return `s` with all letters converted to upper case.",
			z.tuple([zString]),
			([s]) => s.toUpperCase(),
		);
		this.def(
			"string-downcase",
			1,
			"(string-downcase s)",
			"Return `s` with all letters converted to lower case.",
			z.tuple([zString]),
			([s]) => s.toLowerCase(),
		);

		this.def(
			"read",
			1,
			"(read s)",
			'Parse the first Lisp expression in the string `s` and return it as DATA, unevaluated: `(read "(+ 1 2)")` returns the list `(+ 1 2)`, not 3. Anything after that first expression is ignored. Errors if `s` holds no expression. JSON is not Lisp syntax — parse it with `json-parse`.',
			z.tuple([zString]),
			([s]) => {
				const reader = new Reader();
				reader.push(s);
				try {
					return reader.read();
				} catch (ex) {
					if (ex === EndOfFile)
						throw new EvalException("read: no expression in", s);
					throw ex;
				}
			},
		);
		this.def(
			"json-parse",
			1,
			"(json-parse s)",
			'Parse the JSON document in the string `s` into Lisp data: an object becomes an alist with string keys (`(cdr (assoc "title" x))` reads a field), an array becomes a list, `true` becomes t, and both `false` and `null` become nil. Errors on invalid JSON.',
			z.tuple([zString]),
			([s]) => {
				try {
					return jsonToLisp(JSON.parse(s));
				} catch (ex) {
					throw new EvalException(
						"json-parse: invalid JSON",
						ex instanceof Error ? ex.message : String(ex),
						false,
					);
				}
			},
		);

		this.defGen(
			"apply",
			2,
			"(apply f args)",
			"Call `f` with the elements of the list `args` as its arguments.",
			z.tuple([zAny, zList]),
			(a) => this.applyForm(a),
		);

		this.def(
			"exit",
			1,
			"(exit code)",
			"Exit the process with the given status code.",
			z.tuple([zNumeric]),
			([code]) => exit(Number(code)),
		);
		this.defGen(
			"import",
			1,
			'(import "path")',
			"Read the Lisp file at `path` and evaluate it in the current environment, so its definitions become available here (import * from the file). Relative paths resolve against the importing file's directory. Circular imports are skipped. Returns nil.",
			z.tuple([zString]),
			([path]) => this.importFile(path),
		);
		this.def(
			"dump",
			0,
			"(dump)",
			"Return a list of all global symbols.",
			z.tuple([]),
			() => {
				let s: List = null;
				for (const x of this.globals.keys()) s = new Cell(x, s);
				return s;
			},
		);

		this.globals.set(
			newSym("*version*"),
			new Cell(2.1, new Cell("TypeScript", new Cell("Lisptc", null))),
		);
		this.docTable.set("*version*", {
			signature: "*version*",
			doc: "The interpreter version: (number implementation-language name).",
		});

		this.def(
			"_set-doc",
			3,
			"(_set-doc 'name args-or-signature docstring)",
			"Register documentation for the binding `name`; return `name`.",
			z.tuple([
				zAny,
				z.custom<string | List>(
					(x) => typeof x === "string" || x === null || x instanceof Cell,
					"string or list expected",
				),
				zAny,
			]),
			([sym, argsOrSig, docstring]) => {
				if (sym instanceof Sym && typeof docstring === "string") {
					const sig =
						typeof argsOrSig === "string"
							? argsOrSig
							: `(${[sym.name, ...listToStrings(argsOrSig)].join(" ")})`;
					this.docTable.set(sym.name, { signature: sig, doc: docstring });
				}
				return sym;
			},
		);

		this.def(
			"error",
			1,
			"(error value)",
			"Signal a catchable error carrying `value`. A `(try ... (catch (e) ...))` wrapping the call binds `e` to `value` exactly (any Lisp value, not just a string).",
			z.tuple([zAny]),
			([value]) => {
				throw new EvalException("error", value, true);
			},
		);
		this.def(
			"break",
			0,
			"(break)",
			"Exit the nearest enclosing while/dolist/dotimes loop immediately; the loop evaluates to nil.",
			z.tuple([]),
			() => {
				throw new LoopSignal(null);
			},
		);
		this.def(
			"return",
			1,
			"(return value)",
			"Exit the nearest enclosing while/dolist/dotimes loop immediately; the loop evaluates to value.",
			z.tuple([zAny]),
			([value]) => {
				throw new LoopSignal(value);
			},
		);
		this.defGen(
			"_run-loop-body",
			1,
			"(_run-loop-body thunk)",
			"Internal: call the 0-arg thunk, catching only a break/return loop signal (any other exception, including a genuine Lisp error, propagates unchanged). Returns (signalled? . value): signalled? is t iff break/return fired.",
			z.tuple([zAny]),
			(a) => this.runLoopBody(a),
		);

		for (const extension of options.extensions ?? []) extension(this);
	}

	def<T extends z.ZodType>(
		name: string,
		carity: number,
		signature: string,
		doc: string,
		schema: T,
		body: (a: z.infer<T>) => unknown,
		args?: DocArg[],
	) {
		const wrapped: BuiltInFuncBody = (a) => body(parseArgs(schema, a));
		this.globals.set(newSym(name), new BuiltInFunc(name, carity, wrapped));
		this.docTable.set(name, { signature, doc, args });
	}

	defGen<T extends z.ZodType>(
		name: string,
		carity: number,
		signature: string,
		doc: string,
		schema: T,
		body: (a: z.infer<T>) => Eval,
		args?: DocArg[],
	) {
		const wrapped: BuiltInFuncGen = (a) => body(parseArgs(schema, a));
		this.globals.set(
			newSym(name),
			new BuiltInFunc(name, carity, wrapped, "generator"),
		);
		this.docTable.set(name, { signature, doc, args });
	}

	defPromise<T extends z.ZodType>(
		name: string,
		carity: number,
		signature: string,
		doc: string,
		schema: T,
		body: (a: z.infer<T>) => Promise<unknown>,
		args?: DocArg[],
	) {
		const wrapped: BuiltInFuncBody = (a) => body(parseArgs(schema, a));
		this.globals.set(
			newSym(name),
			new BuiltInFunc(name, carity, wrapped, "promise"),
		);
		this.docTable.set(name, { signature, doc, args });
	}

	defineGlobal(sym: Sym, value: unknown, doc?: Doc): void {
		this.globals.set(sym, value);
		if (doc !== undefined) this.docTable.set(sym.name, doc);
	}

	undefineGlobal(sym: Sym): void {
		this.globals.delete(sym);
		this.docTable.delete(sym.name);
	}

	hasGlobal(sym: Sym): boolean {
		return this.globals.has(sym);
	}

	getGlobal(sym: Sym): unknown {
		return this.globals.get(sym);
	}

	globalEntries(): IterableIterator<[Sym, unknown]> {
		return this.globals.entries();
	}

	private say(text: string): void {
		this.channels.emit({ channel: USER, text });
	}

	dispose(): void {
		this.hooks.dispose.run(() => {});
	}

	makeBuiltIn(name: string, carity: number, body: BuiltInFuncBody): unknown {
		return new BuiltInFunc(name, carity, body);
	}

	evalNow(x: unknown, env: List): unknown {
		if (x instanceof Arg) {
			assert(env !== null);
			return x.getValue(env);
		}
		if (x instanceof Sym) {
			const value = this.globals.get(x);
			if (value === undefined) throw new EvalException("void variable", x);
			return value;
		}
		if (x instanceof Lambda) return Closure.makeFrom(x, env);
		return x;
	}

	*evalGen(x: unknown, env: List): Eval {
		try {
			for (;;) {
				if (x instanceof Arg) {
					assert(env !== null);
					return x.getValue(env);
				} else if (x instanceof Sym) {
					const value = this.globals.get(x);
					if (value === undefined) throw new EvalException("void variable", x);
					return value;
				} else if (x instanceof Cell) {
					let fn = x.car;
					const arg = cdrCell(x);
					if (fn instanceof Keyword) {
						switch (<Keyword>fn) {
							case quoteSym:
								if (arg !== null && arg.cdr === null) return arg.car;
								throw new EvalException("bad quote", x);
							case prognSym:
								x =
									arg !== null && arg.cdr === null
										? arg.car
										: yield* this.evalProgN(arg, env);
								break;
							case condSym:
								x = yield* this.evalCond(arg, env);
								break;
							case setqSym:
								return yield* this.evalSetQ(arg, env);
							case trySym: {
								const [nx, nenv] = yield* this.evalTry(arg, env);
								x = nx;
								env = nenv;
								break;
							}
							case lambdaSym:
								return this.compile(arg, env, Closure.make);
							case macroSym:
								if (env !== null) throw new EvalException("nested macro", x);
								return this.compile(arg, null, Macro.make);
							case quasiquoteSym:
								if (arg !== null && arg.cdr === null) {
									x = qqExpand(arg.car);
									break;
								}
								throw new EvalException("bad quasiquote", x);
							default:
								throw new EvalException("bad keyword", fn);
						}
					} else {
						if (fn instanceof Sym) {
							fn = this.globals.get(fn);
							if (fn === undefined) throw new EvalException("undefined", x.car);
						} else if (fn instanceof Cell) {
							fn = yield* this.evalGen(fn, env);
						} else {
							fn = this.evalNow(fn, env);
						}

						if (fn instanceof Macro) {
							x = yield* fn.expandWith(this, arg);
						} else if (fn instanceof Closure || fn instanceof BuiltInFunc) {
							const frame = fn.makeFrame(arg);
							const fixed = fn.fixedArgs;
							for (let i = 0; i < fixed; i++) {
								const a = frame[i];
								frame[i] =
									a instanceof Cell
										? yield* this.evalGen(a, env)
										: this.evalNow(a, env);
							}
							if (fn.hasRest && frame[fixed] instanceof Cell) {
								let head: List = null;
								let tail: List = null;
								for (let j = frame[fixed] as List; j !== null; j = cdrCell(j)) {
									const a = j.car;
									const cell = new Cell(
										a instanceof Cell
											? yield* this.evalGen(a, env)
											: this.evalNow(a, env),
										null,
									);
									if (tail === null) head = cell;
									else tail.cdr = cell;
									tail = cell;
								}
								frame[fixed] = head;
							}
							if (fn instanceof BuiltInFunc) {
								if (fn.kind === "generator") return yield* fn.callGen(frame);
								const value = fn.call(frame);
								if (fn.kind === "plain" && value instanceof Promise)
									return yield* fn.settle(value);
								return value;
							}
							env = new Cell(frame, fn.env);
							const { body } = fn;
							x =
								body !== null && body.cdr === null
									? body.car
									: yield* this.evalProgN(body, env);
						} else {
							throw new EvalException("not applicable", fn);
						}
					}
				} else if (x instanceof Lambda) {
					return Closure.makeFrom(x, env);
				} else {
					return x;
				}
			}
		} catch (ex) {
			if (ex instanceof EvalException) {
				if (ex.trace.length < 10) ex.trace.push(str(x));
			}
			throw ex;
		}
	}

	private *applyForm([f, args]: [unknown, List]): Eval {
		return yield* this.evalGen(new Cell(f, mapcar(args, qqQuote)), null);
	}

	private *runLoopBody([thunk]: [unknown]): Eval {
		try {
			yield* this.evalGen(new Cell(thunk, null), null);
			return new Cell(null, null);
		} catch (ex) {
			if (ex instanceof LoopSignal) return new Cell(true, ex.value);
			throw ex;
		}
	}

	private *evalProgN(j: List, env: List): Eval {
		if (j === null) return null;
		for (;;) {
			const x = j.car;
			j = cdrCell(j);
			if (j === null) return x;
			if (x instanceof Cell) yield* this.evalGen(x, env);
			else this.evalNow(x, env);
		}
	}

	private *evalCond(j: List, env: List): Eval {
		for (; j !== null; j = cdrCell(j)) {
			const clause = j.car;
			if (clause instanceof Cell) {
				const test = clause.car;
				const result =
					test instanceof Cell
						? yield* this.evalGen(test, env)
						: this.evalNow(test, env);
				if (result !== null) {
					const body = cdrCell(clause);
					if (body === null) return qqQuote(result);
					if (body.cdr === null) return body.car;
					return yield* this.evalProgN(body, env);
				}
			} else if (clause !== null) {
				throw new EvalException("cond test expected", clause);
			}
		}
		return null;
	}

	private *evalTry(arg: List, env: List): Eval<[unknown, List]> {
		if (arg === null) throw new EvalException("bad try", arg);
		const bodyForm = arg.car;
		const rest = cdrCell(arg);
		if (rest === null || rest.cdr !== null)
			throw new EvalException("try: exactly one catch clause expected", arg);
		const clause = rest.car;
		if (!(clause instanceof Cell) || clause.car !== catchSym)
			throw new EvalException("try: catch clause expected", clause);
		const catchRest = cdrCell(clause);
		if (catchRest === null)
			throw new EvalException("try: catch variable expected", clause);
		const params = catchRest.car;
		if (!(params instanceof Cell) || params.cdr !== null)
			throw new EvalException(
				"try: catch expects exactly one variable",
				params,
			);
		const handlerBody = cdrCell(catchRest);

		try {
			return [qqQuote(yield* this.evalGen(bodyForm, env)), env];
		} catch (ex) {
			if (!(ex instanceof EvalException)) throw ex;
			const handler = this.compile(
				new Cell(params, handlerBody),
				env,
				Closure.make,
			);
			if (!(handler instanceof Closure))
				throw new EvalException("bad try", clause);
			const frame = handler.makeFrame(new Cell(null, null));
			frame[0] = ex.value;
			const newEnv = new Cell(frame, handler.env);
			return [yield* this.evalProgN(handler.body, newEnv), newEnv];
		}
	}

	private *importFile(path: string): Eval<null> {
		const baseDir =
			this.importStack.length > 0
				? this.importStack[this.importStack.length - 1]
				: process.cwd();
		const abs = resolvePath(baseDir, path);
		if (this.importing.has(abs)) return null;
		let text: string;
		try {
			text = readFileSync(abs, "utf8");
		} catch {
			throw new EvalException("cannot read import file", abs);
		}
		this.importing.add(abs);
		this.importStack.push(dirname(abs));
		try {
			yield* runGen(this, text);
		} finally {
			this.importStack.pop();
			this.importing.delete(abs);
		}
		return null;
	}

	private *evalSetQ(j: List, env: List): Eval {
		let result: unknown = null;
		for (; j !== null; j = cdrCell(j)) {
			const lval = j.car;
			j = cdrCell(j);
			if (j === null) throw new EvalException("right value expected", lval);
			const rval = j.car;
			result =
				rval instanceof Cell
					? yield* this.evalGen(rval, env)
					: this.evalNow(rval, env);
			if (lval instanceof Arg) {
				assert(env !== null);
				lval.setValue(result, env);
			} else if (lval instanceof Sym && !(lval instanceof Keyword)) {
				this.globals.set(lval, result);
			} else {
				throw new NotVariableException(lval);
			}
		}
		return result;
	}

	private compile(arg: List, env: List, make: FuncFactory): DefinedFunc {
		if (arg === null) throw new EvalException("arglist and body expected", arg);
		const table = new Map<Sym, Arg>();
		const [hasRest, arity] = makeArgTable(arg.car, table);
		let body = cdrCell(arg);
		body = scanForArgs(body, table) as List;
		body = this.expandMacros(body, 20) as List;
		body = this.compileInners(body) as List;
		return make(hasRest ? -arity : arity, body, env);
	}

	private expandMacros(j: unknown, count: number): unknown {
		if (count > 0 && j instanceof Cell) {
			let k = j.car;
			switch (k) {
				case quoteSym:
				case lambdaSym:
				case macroSym:
					return j;
				case quasiquoteSym: {
					const d = cdrCell(j);
					if (d !== null && d.cdr === null) {
						const z = qqExpand(d.car);
						return this.expandMacros(z, count);
					}
					throw new EvalException("bad quasiquote", j);
				}
				case trySym: {
					const argPart = cdrCell(j);
					const clauseCell = argPart === null ? null : cdrCell(argPart);
					const clause = clauseCell === null ? null : clauseCell.car;
					if (
						argPart === null ||
						clauseCell === null ||
						clauseCell.cdr !== null ||
						!(clause instanceof Cell) ||
						clause.car !== catchSym
					)
						throw new EvalException("bad try", j);
					const bodyForm = this.expandMacros(argPart.car, count);
					const catchRest = cdrCell(clause);
					if (catchRest === null) throw new EvalException("bad try", j);
					const params = catchRest.car;
					const handlers = mapcar(cdrCell(catchRest), (h) =>
						this.expandMacros(h, count),
					);
					return new Cell(
						trySym,
						new Cell(
							bodyForm,
							new Cell(new Cell(catchSym, new Cell(params, handlers)), null),
						),
					);
				}
				default:
					if (k instanceof Sym) k = this.globals.get(k);
					if (k instanceof Macro) {
						const d = cdrCell(j);
						const z = driveSync(k.expandWith(this, d));
						return this.expandMacros(z, count - 1);
					}
					return mapcar(j, (x) => this.expandMacros(x, count));
			}
		} else {
			return j;
		}
	}

	private compileInners(j: unknown): unknown {
		if (j instanceof Cell) {
			const k = j.car;
			switch (k) {
				case quoteSym:
					return j;
				case lambdaSym: {
					const d = cdrCell(j);
					return this.compile(d, null, Lambda.make);
				}
				case macroSym:
					throw new EvalException("nested macro", j);
				default:
					return mapcar(j, (x) => this.compileInners(x));
			}
		} else {
			return j;
		}
	}
}

function makeArgTable(arg: unknown, table: Map<Sym, Arg>): [boolean, number] {
	if (arg === null) {
		return [false, 0];
	} else if (arg instanceof Cell) {
		let ag = arg as List;
		let offset = 0;
		let hasRest = false;
		for (; ag !== null; ag = cdrCell(ag)) {
			let j = ag.car;
			if (hasRest) throw new EvalException("2nd rest", j);
			if (j === restSym) {
				ag = cdrCell(ag);
				if (ag === null) throw new NotVariableException(ag);
				j = ag.car;
				if (j === restSym) throw new NotVariableException(j);
				hasRest = true;
			}
			let sym: Sym;
			if (j instanceof Sym) sym = j;
			else if (j instanceof Arg) sym = j.symbol;
			else throw new NotVariableException(j);
			if (table.has(sym))
				throw new EvalException("duplicated argument name", j);
			table.set(sym, new Arg(0, offset, sym));
			offset++;
		}
		return [hasRest, offset];
	} else {
		throw new EvalException("arglist expected", arg);
	}
}

function scanForArgs(j: unknown, table: Map<Sym, Arg>): unknown {
	if (j instanceof Sym) {
		const k = table.get(j);
		return k === undefined ? j : k;
	} else if (j instanceof Arg) {
		const k = table.get(j.symbol);
		return k === undefined ? new Arg(j.level + 1, j.offset, j.symbol) : k;
	} else if (j instanceof Cell) {
		if (j.car === quoteSym) {
			return j;
		} else if (j.car === quasiquoteSym) {
			return new Cell(quasiquoteSym, scanForQQ(j.cdr, table, 0));
		} else {
			return mapcar(j, (x) => scanForArgs(x, table));
		}
	} else {
		return j;
	}
}

function scanForQQ(j: unknown, table: Map<Sym, Arg>, level: number): unknown {
	if (j instanceof Cell) {
		const k = j.car;
		if (k === quasiquoteSym) {
			return new Cell(k, scanForQQ(j.cdr, table, level + 1));
		} else if (k === unquoteSym || k === unquoteSplicingSym) {
			const d =
				level === 0
					? scanForArgs(j.cdr, table)
					: scanForQQ(j.cdr, table, level - 1);
			if (Object.is(d, j.cdr)) return j;
			return new Cell(k, d);
		} else {
			return mapcar(j, (x) => scanForQQ(x, table, level));
		}
	} else {
		return j;
	}
}

function qqExpand(x: unknown): unknown {
	return qqExpand0(x, 0);
}

function qqExpand0(x: unknown, level: number): unknown {
	if (x instanceof Cell) {
		if (x.car === unquoteSym) {
			if (level === 0) return (x.cdr as Cell).car;
		}
		const t = qqExpand1(x, level);
		if (t.car instanceof Cell && t.cdr === null) {
			const k = t.car;
			if (k.car === listSym || k.car === consSym) return k;
		}
		return new Cell(appendSym, t);
	} else {
		return qqQuote(x);
	}
}

function qqQuote(x: unknown): unknown {
	if (x instanceof Sym || x instanceof Cell)
		return new Cell(quoteSym, new Cell(x, null));
	return x;
}

function qqExpand1(x: unknown, level: number): Cell {
	if (x instanceof Cell) {
		if (x.car === unquoteSym) {
			if (level === 0) return x.cdr as Cell;
			level--;
		} else if (x.car === quasiquoteSym) {
			level++;
		}
		const h = qqExpand2(x.car, level);
		const t = qqExpand1(x.cdr, level);
		if (t.car === null && t.cdr === null) {
			return new Cell(h, null);
		} else if (h instanceof Cell) {
			if (h.car === listSym) {
				const tcar = t.car;
				if (tcar instanceof Cell) {
					if (tcar.car === listSym) {
						const hh = qqConcat(h, tcar.cdr);
						return new Cell(hh, t.cdr);
					}
				}
				if (h.cdr instanceof Cell) {
					const hh = qqConsCons(h.cdr, tcar);
					return new Cell(hh, t.cdr);
				}
			}
		}
		return new Cell(h, t);
	} else {
		return new Cell(qqQuote(x), null);
	}
}

function qqConcat(x: Cell, y: unknown): unknown {
	if (x === null) return y;
	return new Cell(x.car, qqConcat(x.cdr as Cell, y));
}

function qqConsCons(x: Cell, y: unknown): unknown {
	if (x === null) return y;
	return new Cell(
		consSym,
		new Cell(x.car, new Cell(qqConsCons(x.cdr as Cell, y), null)),
	);
}

function qqExpand2(y: unknown, level: number): unknown {
	if (y instanceof Cell) {
		switch (y.car) {
			case unquoteSym:
				if (level === 0) return new Cell(listSym, y.cdr);
				level--;
				break;
			case unquoteSplicingSym:
				if (level === 0) return (y.cdr as Cell).car;
				level--;
				break;
			case quasiquoteSym:
				level++;
				break;
		}
	}
	return new Cell(listSym, new Cell(qqExpand0(y, level), null));
}

export function tokenPattern(): RegExp {
	return /\s+|("(\\.?|.)*?"|,@?|[^()'`~" \t]+|.)/g;
}

function endOfString(text: string, i: number): number {
	for (let j = i + 1; j < text.length; j++) {
		const c = text[j];
		if (c === "\n") return j;
		if (c === "\\") j++;
		else if (c === '"') return j + 1;
	}
	return text.length;
}

export function endOfForm(text: string, i: number): number {
	let depth = 0;
	for (let j = i; j < text.length; j++) {
		const c = text[j];
		if (c === '"') {
			j = endOfString(text, j) - 1;
		} else if (c === "(") {
			depth++;
		} else if (c === ")") {
			depth--;
			if (depth === 0) return j + 1;
		}
	}
	return -1;
}

function startOfForm(text: string, i: number): number {
	let j = i;
	while (j > 0 && "'`,@".includes(text[j - 1])) j--;
	return j === 0 || /\s/.test(text[j - 1]) ? j : i;
}

export function stripProse(
	text: string,
	hooks?: Hooks,
	onSkip?: (what: string) => void,
): string {
	const out: string[] = Array.from(text, (c) => (c === "\n" ? "\n" : " "));
	let i = 0;
	while (i < text.length) {
		if (text[i] !== "(") {
			i++;
			continue;
		}
		const end = endOfForm(text, i);
		if (end < 0) {
			const stray = hooks?.unclosedForm.run(noOpinion, text, i);
			if (stray !== undefined) {
				onSkip?.(stray);
				i++;
				continue;
			}
			for (let j = startOfForm(text, i); j < text.length; j++) out[j] = text[j];
			break;
		}
		const start = startOfForm(text, i);
		const unreadable = hooks?.unreadableForm.run(noOpinion, text, start, end);
		if (unreadable !== undefined) {
			onSkip?.(unreadable);
			i = end;
			continue;
		}
		for (let j = start; j < end; j++) out[j] = text[j];
		i = end;
	}
	return out.join("");
}

export interface SyntaxFailure {
	reason: string;
	line: number;
}

export function readFailure(source: string): SyntaxFailure | undefined {
	const reader = new Reader();
	reader.push(source);
	try {
		while (!reader.isEmpty()) reader.read();
	} catch (ex) {
		if (ex === EndOfFile)
			return { reason: "unexpected end of input", line: reader.line };
		if (ex instanceof SyntaxException)
			return { reason: ex.reason, line: ex.line };
	}
	return undefined;
}

export class Reader {
	private token: unknown;
	private tokens: string[] = [];
	private lineNo = 1;

	push(text: string): void {
		const tokenPat = tokenPattern();
		for (const line of text.split("\n")) {
			for (;;) {
				const result = tokenPat.exec(line);
				if (result === null) break;
				const s = result[1];
				if (s !== undefined) this.tokens.push(s);
			}
			this.tokens.push("\n");
		}
	}

	get line(): number {
		return this.lineNo;
	}

	copyFrom(other: Reader): void {
		this.tokens = other.tokens.slice();
		this.lineNo = other.lineNo;
	}

	clear(): void {
		this.tokens.length = 0;
	}

	isEmpty(): boolean {
		return this.tokens.every((t: string) => t === "\n");
	}

	read(): unknown {
		try {
			this.readToken();
			return this.parseExpression();
		} catch (ex) {
			if (ex === EndOfFile) throw EndOfFile;
			else if (ex instanceof FormatException)
				throw new SyntaxException(ex.message, this.lineNo);
			else throw ex;
		}
	}

	private parseExpression(): unknown {
		switch (this.token) {
			case leftParenSym:
				this.readToken();
				return this.parseListBody();
			case singleQuoteSym:
				this.readToken();
				return new Cell(quoteSym, new Cell(this.parseExpression(), null));
			case backQuoteSym:
				this.readToken();
				return new Cell(quasiquoteSym, new Cell(this.parseExpression(), null));
			case commaSym:
				this.readToken();
				return new Cell(unquoteSym, new Cell(this.parseExpression(), null));
			case commaAtSym:
				this.readToken();
				return new Cell(
					unquoteSplicingSym,
					new Cell(this.parseExpression(), null),
				);
			case dotSym:
			case rightParenSym:
				throw new FormatException(`unexpected "${this.token}"`);
			default:
				return this.token;
		}
	}

	private parseListBody(): unknown {
		if (this.token === rightParenSym) {
			return null;
		} else {
			const e1 = this.parseExpression();
			this.readToken();
			let e2: unknown;
			if (this.token === dotSym) {
				this.readToken();
				e2 = this.parseExpression();
				this.readToken();
				if (this.token !== rightParenSym)
					throw new FormatException(`")" expected: ${this.token}`);
			} else {
				e2 = this.parseListBody();
			}
			return new Cell(e1, e2);
		}
	}

	private readToken(): void {
		for (;;) {
			const t = this.tokens.shift();
			if (t === undefined) {
				throw EndOfFile;
			} else if (t === "\n") {
				this.lineNo += 1;
			} else if (t === "+" || t === "-") {
				this.token = newSym(t);
				return;
			} else {
				if (t[0] === '"') {
					let s = t;
					const n = s.length - 1;
					if (n < 1 || s[n] !== '"')
						throw new FormatException(`bad string: ${s}`);
					s = s.substring(1, n);
					s = s.replace(/\\./g, (m: string) => {
						const val = Reader.escapes[m];
						return val === undefined ? m : val;
					});
					this.token = s;
					return;
				}
				const n = tryToParse(t);
				if (n !== null) this.token = n;
				else if (t === "nil") this.token = null;
				else if (t === "t") this.token = true;
				else if (t.length > 1 && t[0] === ":")
					this.token = newLispKeyword(t.slice(1));
				else if (t.startsWith("#<"))
					throw new EvalException(
						"a #<…> form is a printed handle, not something that can be read back; use the name the REPL reported the value under",
						t,
						false,
					);
				else this.token = newSym(t);
				return;
			}
		}
	}

	private static escapes: { [key: string]: string } = {
		"\\\\": "\\",
		'\\"': '"',
		"\\n": "\n",
		"\\r": "\r",
		"\\f": "\f",
		"\\b": "\b",
		"\\t": "\t",
		"\\v": "\v",
	};
}

const quotes: { [key: string]: string } = {
	[quoteSym.name]: "'",
	[quasiquoteSym.name]: "`",
	[unquoteSym.name]: ",",
	[unquoteSplicingSym.name]: ",@",
};

export function str(
	x: unknown,
	quoteString = true,
	count?: number,
	printed?: Cell[],
): string {
	if (x === null) {
		return "nil";
	} else if (x === true) {
		return "t";
	} else if (x instanceof Promise) {
		return "#<promise>";
	} else if (x instanceof Cell) {
		if (x.car instanceof Sym) {
			const q = quotes[x.car.name];
			if (q !== undefined && x.cdr instanceof Cell)
				if (x.cdr.cdr == null) return q + str(x.cdr.car, true, count, printed);
		}
		return `(${strListBody(x, count, printed)})`;
	} else if (typeof x === "string") {
		if (!quoteString) return x;
		const bf: string[] = ['"'];
		for (const ch of x) {
			switch (ch) {
				case "\b":
					bf.push("\\b");
					break;
				case "\t":
					bf.push("\\t");
					break;
				case "\n":
					bf.push("\\n");
					break;
				case "\v":
					bf.push("\\v");
					break;
				case "\f":
					bf.push("\\f");
					break;
				case "\r":
					bf.push("\\r");
					break;
				case '"':
					bf.push('\\"');
					break;
				case "\\":
					bf.push("\\\\");
					break;
				default:
					bf.push(ch);
					break;
			}
		}
		bf.push('"');
		return bf.join("");
	} else if (Array.isArray(x)) {
		const s = x.map((e) => str(e, true, count, printed)).join(", ");
		return `[${s}]`;
	} else if (x instanceof Sym) {
		return x.isInterned ? x.name : `#:${x}`;
	} else if (isNumeric(x)) {
		return convertToString(x);
	} else {
		return `${x}`;
	}
}

export function echoText(args: List): string {
	const parts: string[] = [];
	for (let p = args; p !== null; p = p.cdr as List)
		parts.push(str((p as Cell).car, false));
	return parts.join(" ");
}

function strListBody(x: Cell, count?: number, printed?: Cell[]): string {
	if (printed === undefined) printed = [];
	if (count === undefined) count = 4;
	const s: string[] = [];
	let y: unknown;
	for (y = x; y instanceof Cell; y = y.cdr) {
		if (printed.indexOf(y) < 0) {
			printed.push(y);
			count = 4;
		} else {
			count--;
			if (count < 0) {
				s.push("...");
				return s.join(" ");
			}
		}
		s.push(str(y.car, true, count, printed));
	}
	if (y !== null) {
		s.push(".");
		s.push(str(y, true, count, printed));
	}
	for (y = x; y instanceof Cell; y = y.cdr) {
		const i = printed.indexOf(y);
		if (i >= 0) printed.splice(i, 1);
	}
	return s.join(" ");
}

export function* evalTopLevel(interp: Interp, exp: unknown): Eval {
	try {
		return yield* interp.evalGen(exp, null);
	} catch (ex) {
		const failure =
			ex instanceof LoopSignal
				? new EvalException("break/return used outside of a loop", null, false)
				: ex;
		if (failure instanceof EvalException)
			interp.channels.emit({
				channel: MODEL,
				severity: "critical",
				text: String(failure),
				value: failure.value,
			});
		throw failure;
	}
}

export function* runGen(interp: Interp, text: string): Eval {
	const { hooks } = interp;
	const skipped = (what: string) =>
		interp.channels.emit({
			channel: MODEL,
			severity: "warning",
			text: what,
		});
	const tokens = new Reader();
	tokens.push(stripProse(text, hooks, skipped));
	let result: unknown = Unspecified;
	while (!tokens.isEmpty()) {
		const exp = tokens.read();
		const note = hooks.skipForm.run(noOpinion, interp, exp);
		if (note !== undefined) {
			skipped(note);
			continue;
		}
		result = yield* hooks.evalForm.run(evalTopLevel, interp, exp);
	}
	return result;
}

export function driveSync<T>(gen: Eval<T>): T {
	let step = gen.next();
	while (!step.done)
		step = gen.throw(
			new EvalException(
				"cannot suspend",
				"this host evaluates synchronously",
				false,
			),
		);
	return step.value;
}

export function runSync(interp: Interp, text: string): unknown {
	return driveSync(runGen(interp, text));
}

export interface Outcome<T = unknown> {
	value: T;
}

export async function driveAsync<T>(gen: Eval<T>): Promise<Outcome<T>> {
	let step = gen.next();
	while (!step.done) {
		let resumed: unknown;
		try {
			resumed = await step.value;
		} catch (ex) {
			step = gen.throw(ex);
			continue;
		}
		step = gen.next(resumed);
	}
	return { value: step.value };
}

export function runAsync(interp: Interp, text: string): Promise<Outcome> {
	return driveAsync(runGen(interp, text));
}

export interface SyntaxError_ {
	message: string;
	line: number;
}

export function checkSyntax(text: string): SyntaxError_[] {
	const tokens = new Reader();
	tokens.push(stripProse(text));
	while (!tokens.isEmpty()) {
		try {
			tokens.read();
		} catch (ex) {
			if (ex === EndOfFile)
				return [
					{
						message: "unexpected end of input (unbalanced parentheses?)",
						line: tokens.line,
					},
				];
			if (ex instanceof EvalException)
				return [{ message: String(ex.message), line: tokens.line }];
			throw ex;
		}
	}
	return [];
}

export const prelude = `
(setq defmacro
      (macro (name args &rest body)
             \`(progn (setq ,name (macro ,args ,@body))
                     (_set-doc ',name ',args ,(cond ((stringp (car body)) (car body))))
                     ',name)))
(_set-doc 'defmacro "(defmacro name (arg...) [docstring] body...)"
          "Define a global macro named name. A leading docstring is registered as its documentation.")

(defmacro defun (name args &rest body)
  "Define a global function named name. A leading docstring is registered as its documentation; use &rest for variadic arguments."
  \`(progn (setq ,name (lambda ,args ,@body))
          (_set-doc ',name ',args ,(cond ((stringp (car body)) (car body))))
          ',name))

(defun caar (x)
  "(car (car x))" (car (car x)))
(defun cadr (x)
  "(car (cdr x)) - the second element of a list." (car (cdr x)))
(defun cdar (x)
  "(cdr (car x))" (cdr (car x)))
(defun cddr (x)
  "(cdr (cdr x))" (cdr (cdr x)))
(defun caaar (x)
  "(car (car (car x)))" (car (car (car x))))
(defun caadr (x)
  "(car (car (cdr x)))" (car (car (cdr x))))
(defun cadar (x)
  "(car (cdr (car x)))" (car (cdr (car x))))
(defun caddr (x)
  "(car (cdr (cdr x))) - the third element of a list." (car (cdr (cdr x))))
(defun cdaar (x)
  "(cdr (car (car x)))" (cdr (car (car x))))
(defun cdadr (x)
  "(cdr (car (cdr x)))" (cdr (car (cdr x))))
(defun cddar (x)
  "(cdr (cdr (car x)))" (cdr (cdr (car x))))
(defun cdddr (x)
  "(cdr (cdr (cdr x)))" (cdr (cdr (cdr x))))
(defun not (x)
  "Return t if x is nil. Alias: null." (eq x nil))
(defun consp (x)
  "Return t if x is a cons cell (a non-empty list)." (not (atom x)))
(defun identity (x)
  "Return x unchanged." x)

(setq
 = eql
 rem %
 null not
 setcar rplaca
 setcdr rplacd)
(_set-doc '= "(= x y)" "Return t if x and y are numerically equal (alias of eql).")
(_set-doc 'rem "(rem x y)" "Return the remainder of x divided by y (alias of %).")
(_set-doc 'null "(null x)" "Return t if x is nil (alias of not).")
(_set-doc 'setcar "(setcar cell x)" "Destructively set the car of cell to x (alias of rplaca).")
(_set-doc 'setcdr "(setcdr cell x)" "Destructively set the cdr of cell to x (alias of rplacd).")

(defun > (x y)
  "Return t if x is numerically greater than y." (< y x))
(defun >= (x y)
  "Return t if x is greater than or equal to y." (not (< x y)))
(defun <= (x y)
  "Return t if x is less than or equal to y." (not (< y x)))
(defun /= (x y)
  "Return t if x and y are not numerically equal." (not (= x y)))

(defun equal (x y)
  "Return t if x and y are structurally equal (recursing into lists)."
  (cond ((atom x) (eql x y))
        ((atom y) nil)
        ((equal (car x) (car y)) (equal (cdr x) (cdr y)))))

(defmacro if (test then &rest else)
  "If test is non-nil, evaluate then; otherwise evaluate the else forms."
  \`(cond (,test ,then)
         ,@(cond (else \`((t ,@else))))))

(defmacro when (test &rest body)
  "If test is non-nil, evaluate body and return its last value."
  \`(cond (,test ,@body)))

(defmacro unless (test &rest body)
  "If test is nil, evaluate body and return its last value."
  \`(cond ((not ,test) ,@body)))

(defmacro let (args &rest body)
  "Bind variables in parallel, then evaluate body. A bare name binds to nil."
  ((lambda (vars vals)
     (defun vars (x)
       (cond (x (cons (if (atom (car x))
                          (car x)
                        (caar x))
                      (vars (cdr x))))))
     (defun vals (x)
       (cond (x (cons (if (atom (car x))
                          nil
                        (cadar x))
                      (vals (cdr x))))))
     \`((lambda ,(vars args) ,@body) ,@(vals args)))
   nil nil))

(defmacro letrec (args &rest body)
  "Like let, but bindings may refer to each other (e.g. for local recursive functions)."
  (let (vars sets)
    (defun vars (x)
      (cond (x (cons (caar x)
                     (vars (cdr x))))))
    (defun sets (x)
      (cond (x (cons \`(setq ,(caar x) ,(cadar x))
                     (sets (cdr x))))))
    \`(let ,(vars args) ,@(sets args) ,@body)))

(defmacro let* (args &rest body)
  "Like let, but the bindings happen in sequence, so each one can use the values bound before it."
  (let (nest)
    (defun nest (bs)
      (if (null bs)
          \`(let () ,@body)
        \`(let (,(car bs)) ,(nest (cdr bs)))))
    (nest args)))

(defun _append (x y)
  (if (null x)
      y
    (cons (car x) (_append (cdr x) y))))
(defmacro append (x &rest y)
  "Return the concatenation of the given lists (copies all but the last)."
  (if (null y)
      x
    \`(_append ,x (append ,@y))))

(defmacro and (x &rest y)
  "Evaluate left to right; return nil on the first nil value, else the last value."
  (if (null y)
      x
    \`(cond (,x (and ,@y)))))

(defun mapcar (f x)
  "Return a new list of f applied to each element of x."
  (and x (cons (f (car x)) (mapcar f (cdr x)))))

(defun nth (n x)
  "Return the element of the list x at index n, counting from 0; nil if n is past the end."
  (cond ((null x) nil)
        ((< n 0) nil)
        ((< n 1) (car x))
        (t (nth (- n 1) (cdr x)))))

(defun filter (f x)
  "Return a new list of the elements of x for which f returns non-nil."
  (cond ((null x) nil)
        ((f (car x)) (cons (car x) (filter f (cdr x))))
        (t (filter f (cdr x)))))

(defun _reduce (f acc x)
  (if (null x)
      acc
    (_reduce f (f acc (car x)) (cdr x))))
(defun reduce (f list &rest initial)
  "Fold list left to right into one value: call f with the accumulator and each element in turn. Without an initial value the first element starts the fold, and an empty list gives nil. (reduce + '(1 2 3)) is 6."
  (cond ((not (listp list))
         (error "reduce: the list comes second and the initial value last, as (reduce f list [initial])"))
        (initial (_reduce f (car initial) list))
        ((null list) nil)
        (t (_reduce f (car list) (cdr list)))))

(defmacro or (x &rest y)
  "Evaluate left to right; return the first non-nil value, else nil."
  (if (null y)
      x
    \`(cond (,x)
           ((or ,@y)))))

(defun listp (x)
  "Return t if x is a list (nil or a cons cell)."
  (or (null x) (consp x)))

(defun memq (key x)
  "Return the tail of x whose car is eq to key, or nil."
  (cond ((null x) nil)
        ((eq key (car x)) x)
        (t (memq key (cdr x)))))

(defun member (key x)
  "Return the tail of x whose car is equal to key, or nil."
  (cond ((null x) nil)
        ((equal key (car x)) x)
        (t (member key (cdr x)))))

(defun assq (key alist)
  "Return the first pair of alist whose car is eq to key, or nil."
  (cond (alist (let ((e (car alist)))
                 (if (and (consp e) (eq key (car e)))
                     e
                   (assq key (cdr alist)))))))

(defun assoc (key alist)
  "Return the first pair of alist whose car is equal to key, or nil."
  (cond (alist (let ((e (car alist)))
                 (if (and (consp e) (equal key (car e)))
                     e
                   (assoc key (cdr alist)))))))

(defun _key-name (key)
  (let ((name (string key)))
    (if (string-prefix? ":" name)
        (substring name 1)
      name)))
(defun _alist-get (key alist)
  (let ((hit (assoc key alist)))
    (cond (hit (cdr hit))
          ((stringp key) nil)
          (t (cdr (assoc (_key-name key) alist))))))
(defun get-in (record &rest keys)
  "Read a value out of nested alists and lists: each key is an alist key, or a number to index a list. Every step is guarded, so a missing key or a nil along the way gives nil instead of an error: (get-in config \\"server\\" \\"port\\"), (get-in reply \\"results\\" 0 \\"url\\"). A symbol or keyword key also matches the string of its name, so :port finds \\"port\\"."
  (let ((value record))
    (dolist (key keys value)
      (setq value (cond ((not (consp value)) nil)
                        ((numberp key) (nth key value))
                        (t (_alist-get key value)))))))

(defun _nreverse (x prev)
  (let ((next (cdr x)))
    (setcdr x prev)
    (if (null next)
        x
      (_nreverse next x))))
(defun nreverse (list)
  "Reverse list destructively; return the reversed list."
  (cond (list (_nreverse list nil))))

(defun last (list)
  "Return the last cons cell of list."
  (if (atom (cdr list))
      list
    (last (cdr list))))

(defun nconc (&rest lists)
  "Concatenate the lists destructively; return the result."
  (if (null (cdr lists))
      (car lists)
    (if (null (car lists))
        (apply nconc (cdr lists))
      (setcdr (last (car lists))
              (apply nconc (cdr lists)))
      (car lists))))

(defmacro while (test &rest body)
  "Loop: evaluate body while test is non-nil; return nil, or (return value)'s value if given; (break) also ends the loop early, returning nil."
  (let ((loop (gensym))
        (signal (gensym)))
    \`(letrec ((,loop (lambda ()
                        (cond (,test
                               (let ((,signal (_run-loop-body (lambda () ,@body))))
                                 (if (car ,signal)
                                     (cdr ,signal)
                                   (,loop))))))))
       (,loop))))

(defmacro dolist (spec &rest body)
  "Evaluate body with name (car of spec) bound to each element of the list (cadr of spec); return the optional third element of spec, or a (break)/(return value)'s outcome if the loop is interrupted (skipping the result form)."
  (let ((name (car spec))
        (list (gensym))
        (loop (gensym))
        (signal (gensym)))
    \`(let (,name
           (,list ,(cadr spec)))
       (letrec ((,loop (lambda ()
                          (cond (,list
                                 (setq ,name (car ,list))
                                 (let ((,signal (_run-loop-body (lambda () ,@body))))
                                   (if (car ,signal)
                                       (cdr ,signal)
                                     (progn (setq ,list (cdr ,list))
                                            (,loop)))))
                                (t ,@(if (cddr spec)
                                         \`((setq ,name nil) ,(caddr spec))
                                       '(nil)))))))
         (,loop)))))

(defmacro dotimes (spec &rest body)
  "Evaluate body with name (car of spec) bound to 0..count-1; return the optional third element of spec, or a (break)/(return value)'s outcome if the loop is interrupted (skipping the result form)."
  (let ((name (car spec))
        (count (gensym))
        (loop (gensym))
        (signal (gensym)))
    \`(let ((,name 0)
           (,count ,(cadr spec)))
       (letrec ((,loop (lambda ()
                          (cond ((< ,name ,count)
                                 (let ((,signal (_run-loop-body (lambda () ,@body))))
                                   (if (car ,signal)
                                       (cdr ,signal)
                                     (progn (setq ,name (+ ,name 1))
                                            (,loop)))))
                                (t ,@(if (cddr spec)
                                         \`(,(caddr spec))
                                       '(nil)))))))
         (,loop)))))

(defmacro case (key-expr &rest clauses)
  "CL-style case: (case key-expr (keylist forms...)... (t forms...)). Evaluates key-expr once and runs the forms of the first clause whose keylist (a list of keys, or a single non-list key) contains a value equal to it; a clause headed by the symbol t is the default and always matches (wrap it in a list, e.g. ((t) ...), to use t as a literal key instead). Returns nil if no clause matches."
  (let ((key (gensym))
        expand)
    (defun expand (cls)
      (cond ((null cls) nil)
            (t (cons (if (eq (caar cls) t)
                         \`(t ,@(cdar cls))
                       \`((member ,key ',(if (consp (caar cls)) (caar cls) (list (caar cls))))
                         ,@(cdar cls)))
                     (expand (cdr cls))))))
    \`(let ((,key ,key-expr))
       (cond ,@(expand clauses)))))

(defmacro think (&rest body)
  "(think part...) Print reasoning as narration: each part prints literally, except a comma-unquoted part (or a ,@ splice), which is evaluated first so the trace is grounded in real values instead of guesses. Ends with a newline and returns nil -- put your actual answer in a separate expression, not inside think."
  (list 'progn
        (list 'apply 'echo (list 'quasiquote body))
        nil))

--- String library ---
Built on the native primitives char, concat, string-upcase and
string-downcase, plus length, which works on strings too.

(defun substring (s start &rest end)
  "Return the substring of s from index start up to (but not including) end (default: end of s)."
  (let ((stop (if end (car end) (length s)))
        (out ""))
    (while (< start stop)
      (setq out (concat out (char s start)))
      (setq start (+ start 1)))
    out))

(defun string-prefix? (prefix s)
  "Return t if the string s starts with prefix."
  (and (<= (length prefix) (length s))
       (equal prefix (substring s 0 (length prefix)))))

(defun string-suffix? (suffix s)
  "Return t if the string s ends with suffix."
  (and (<= (length suffix) (length s))
       (equal suffix (substring s (- (length s) (length suffix))))))

(defun string-index (s sub &rest start)
  "Return the index of the first occurrence of sub in s at or after start (default 0), or nil."
  (let ((i (if start (car start) 0))
        (last (- (length s) (length sub)))
        (found nil))
    (while (and (null found) (<= i last))
      (if (equal sub (substring s i (+ i (length sub))))
          (setq found i)
        (setq i (+ i 1))))
    found))

(defun string-contains? (s sub)
  "Return t if s contains the substring sub."
  (and (string-index s sub) t))

(defun string-count (s sub)
  "Return the number of non-overlapping occurrences of sub in s."
  (if (equal sub "")
      (+ (length s) 1)
    (let ((i 0)
          (n 0)
          (pos nil))
      (while (setq pos (string-index s sub i))
        (setq n (+ n 1))
        (setq i (+ pos (length sub))))
      n)))

(defun string-replace (s old new)
  "Return s with every occurrence of the substring old replaced by new."
  (if (equal old "")
      s
    (let ((out "")
          (i 0)
          (pos nil))
      (while (setq pos (string-index s old i))
        (setq out (concat out (substring s i pos) new))
        (setq i (+ pos (length old))))
      (concat out (substring s i)))))

(defun string-split (s sep)
  "Split s on the separator string sep and return a list of strings; an empty sep splits into characters."
  (if (equal sep "")
      (let ((chars nil)
            (i (length s)))
        (while (< 0 i)
          (setq i (- i 1))
          (setq chars (cons (char s i) chars)))
        chars)
    (let ((parts nil)
          (i 0)
          (pos nil))
      (while (setq pos (string-index s sep i))
        (setq parts (cons (substring s i pos) parts))
        (setq i (+ pos (length sep))))
      (nreverse (cons (substring s i) parts)))))

(defun string-join (list sep)
  "Join the strings in list into one string separated by sep."
  (cond ((null list) "")
        ((null (cdr list)) (car list))
        (t (concat (car list) sep (string-join (cdr list) sep)))))

(defun _whitespace? (c)
  (or (equal c " ") (equal c "\\t") (equal c "\\n") (equal c "\\r")))
(defun string-trim (s)
  "Return s with leading and trailing whitespace removed."
  (let ((start 0)
        (end (length s)))
    (while (and (< start end) (_whitespace? (char s start)))
      (setq start (+ start 1)))
    (while (and (< start end) (_whitespace? (char s (- end 1))))
      (setq end (- end 1)))
    (substring s start end)))
`;
