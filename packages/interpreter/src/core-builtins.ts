import { z } from "zod";
import {
	add,
	compare,
	divide,
	isNumeric,
	multiply,
	type Numeric,
	ONE,
	quotient,
	remainder,
	subtract,
	ZERO,
} from "./arith.ts";
import type { Channels } from "./channels.ts";
import { LispHashTable, LispVector } from "./collections.ts";
import {
	DOC_DOC,
	DOC_SIGNATURE,
	type Doc,
	type DocArg,
	type DocSource,
	lookupDoc,
} from "./docs.ts";
import type { Eval } from "./drive.ts";
import { EvalException, LoopSignal, ThrowSignal } from "./errors.ts";
import { BuiltInFunc } from "./func.ts";
import {
	Cell,
	EndOfFile,
	foldl,
	jsonToLisp,
	LispKeyword,
	type List,
	newLispKeyword,
	newSym,
	Sym,
	Unspecified,
} from "./objects.ts";
import { echoText, str } from "./print.ts";
import { Reader } from "./reader.ts";
import { zAny, zCell, zList, zNumeric, zString, zSym } from "./schema.ts";
import { output } from "./topics.ts";

export interface Definer extends DocSource {
	readonly channels: Channels;
	def<T extends z.ZodType>(
		name: string,
		carity: number,
		signature: string,
		doc: string,
		schema: T,
		body: (a: z.infer<T>) => unknown,
		args?: DocArg[],
	): void;
	defGen<T extends z.ZodType>(
		name: string,
		carity: number,
		signature: string,
		doc: string,
		schema: T,
		body: (a: z.infer<T>) => Eval,
		args?: DocArg[],
	): void;
	defineGlobal(sym: Sym, value: unknown, doc?: Doc): void;
	getGlobal(sym: Sym): unknown;
	undefineGlobal(sym: Sym): void;
	ownerOf(sym: Sym): string | undefined;
	globalEntries(): IterableIterator<[Sym, unknown]>;
	setDoc(name: string, doc: Doc): void;
	setSource(name: string, form: unknown): void;
}

export interface CoreOps {
	apply(a: [unknown, List]): Eval;
	runLoopBody(a: [unknown]): Eval;
	importFile(path: string): Eval<null>;
}

let exit: (n: number) => void = () => {};

export function setExit(fn: (n: number) => void): void {
	exit = fn;
}

function ensureNum(x: unknown): Numeric {
	if (isNumeric(x)) return x;
	throw new EvalException("not a number", x);
}

function keywordArgsIn(tokens: string[]): DocArg[] | undefined {
	const at = tokens.indexOf("&key");
	if (at < 0) return undefined;
	const named = tokens.slice(at + 1).filter((t) => t !== "&rest");
	return named.length === 0
		? undefined
		: named.map((name) => ({ name, type: "any", required: false }));
}

function listToStrings(list: List): string[] {
	const out: string[] = [];
	for (let c = list; c !== null; c = c.cdr as Cell | null) out.push(str(c.car));
	return out;
}

function finiteInteger(x: number): bigint {
	if (!Number.isFinite(x)) throw new EvalException("not a finite number", x);
	return BigInt(x);
}

function bigAbs(x: bigint): bigint {
	return x < 0n ? -x : x;
}

type Rounding = "floor" | "ceiling" | "round";

function roundExact(x: bigint, y: bigint, mode: Rounding): bigint {
	if (y === 0n) throw new EvalException("division by zero", x);
	const negative = x < 0n !== y < 0n;
	const ax = bigAbs(x);
	const ay = bigAbs(y);
	let q = ax / ay;
	const r = ax % ay;
	if (r !== 0n) {
		if (mode === "floor" && negative) q += 1n;
		if (mode === "ceiling" && !negative) q += 1n;
		if (mode === "round" && (2n * r > ay || (2n * r === ay && q % 2n === 1n)))
			q += 1n;
	}
	return negative ? -q : q;
}

function roundFloat(v: number, mode: Rounding): bigint {
	if (mode === "floor") return finiteInteger(Math.floor(v));
	if (mode === "ceiling") return finiteInteger(Math.ceil(v));
	const r = Math.round(v);
	return finiteInteger(Math.abs(v % 1) === 0.5 ? 2 * Math.round(v / 2) : r);
}

function rounded(mode: Rounding, x: Numeric, rest: List): Numeric {
	if (rest !== null && rest.cdr !== null)
		throw new EvalException("one or two arguments expected", rest);
	const y = rest === null ? ONE : ensureNum(rest.car);
	if (typeof x === "bigint" && typeof y === "bigint")
		return roundExact(x, y, mode);
	return roundFloat(Number(x) / Number(y), mode);
}

function ensureInteger(x: unknown): bigint {
	if (typeof x === "bigint") return x;
	if (typeof x === "number" && Number.isInteger(x)) return BigInt(x);
	throw new EvalException("not an integer", x);
}

function gcd(a: bigint, b: bigint): bigint {
	let x = bigAbs(a);
	let y = bigAbs(b);
	while (y !== 0n) [x, y] = [y, x % y];
	return x;
}

function extreme(x: Numeric, rest: List, sign: number): Numeric {
	return foldl(x, rest, (best, y) =>
		compare(ensureNum(y), best as Numeric) === sign ? (y as Numeric) : best,
	);
}

function indexIn(i: Numeric, length: number): number {
	const n = Number(i);
	if (!Number.isInteger(n) || n < 0 || n >= length)
		throw new EvalException("index out of range", i);
	return n;
}

function listItems(xs: List): unknown[] {
	const out: unknown[] = [];
	for (let c = xs; c !== null; c = c.cdr as List) out.push(c.car);
	return out;
}

function arrayToList(items: readonly unknown[]): List {
	let out: List = null;
	for (let i = items.length - 1; i >= 0; i--) out = new Cell(items[i], out);
	return out;
}

const zSequence = z.custom<List | string | LispVector>(
	(x) =>
		x === null ||
		x instanceof Cell ||
		typeof x === "string" ||
		x instanceof LispVector,
	"list, string or vector expected",
);
const zVector = z.custom<LispVector>(
	(x) => x instanceof LispVector,
	"vector expected",
);
const zHashTable = z.custom<LispHashTable>(
	(x) => x instanceof LispHashTable,
	"hash table expected",
);
const zChar = z.custom<string>(
	(x) => typeof x === "string" && [...x].length === 1,
	"one-character string expected",
);

function installNumbers(interp: Definer): void {
	const predicate = (
		name: string,
		doc: string,
		test: (x: Numeric) => boolean,
	) =>
		interp.def(name, 1, `(${name} n)`, doc, z.tuple([zNumeric]), ([x]) =>
			test(x) ? true : null,
		);
	predicate("zerop", "Return t if `n` is zero.", (x) => compare(x, ZERO) === 0);
	predicate(
		"plusp",
		"Return t if `n` is greater than zero.",
		(x) => compare(x, ZERO) > 0,
	);
	predicate(
		"minusp",
		"Return t if `n` is less than zero.",
		(x) => compare(x, ZERO) < 0,
	);
	predicate(
		"evenp",
		"Return t if the integer `n` is even.",
		(x) => ensureInteger(x) % 2n === 0n,
	);
	predicate(
		"oddp",
		"Return t if the integer `n` is odd.",
		(x) => ensureInteger(x) % 2n !== 0n,
	);

	interp.def(
		"1+",
		1,
		"(1+ n)",
		"Return `n` plus one.",
		z.tuple([zNumeric]),
		([x]) => add(x, ONE),
	);
	interp.def(
		"1-",
		1,
		"(1- n)",
		"Return `n` minus one.",
		z.tuple([zNumeric]),
		([x]) => subtract(x, ONE),
	);
	interp.def(
		"abs",
		1,
		"(abs n)",
		"Return the absolute value of `n`, keeping exactness.",
		z.tuple([zNumeric]),
		([x]) => (compare(x, ZERO) < 0 ? -x : x),
	);
	interp.def(
		"min",
		-2,
		"(min n m...)",
		"Return the smallest argument.",
		z.tuple([zNumeric, zList]),
		([x, rest]) => extreme(x, rest, -1),
	);
	interp.def(
		"max",
		-2,
		"(max n m...)",
		"Return the largest argument.",
		z.tuple([zNumeric, zList]),
		([x, rest]) => extreme(x, rest, 1),
	);
	const rounding: [Rounding, string][] = [
		["floor", "toward negative infinity"],
		["ceiling", "toward positive infinity"],
		["round", "to the nearest integer, a tie to the even one"],
	];
	for (const [mode, how] of rounding)
		interp.def(
			mode,
			-2,
			`(${mode} x [y])`,
			`Return \`x\` (or \`x\`/\`y\`) rounded ${how}, as an exact integer.`,
			z.tuple([zNumeric, zList]),
			([x, rest]) => rounded(mode, x, rest),
		);
	interp.def(
		"expt",
		2,
		"(expt base power)",
		"Return `base` raised to `power`: exact for an integer base and a non-negative integer power, a float otherwise.",
		z.tuple([zNumeric, zNumeric]),
		([b, p]) =>
			typeof b === "bigint" && typeof p === "bigint" && p >= 0n
				? b ** p
				: Number(b) ** Number(p),
	);
	interp.def(
		"sqrt",
		1,
		"(sqrt n)",
		"Return the square root of `n` as a float.",
		z.tuple([zNumeric]),
		([x]) => Math.sqrt(Number(x)),
	);
	interp.def(
		"gcd",
		-1,
		"(gcd n...)",
		"Return the greatest common divisor of the integers (0 with no arguments).",
		z.tuple([zList]),
		([rest]) => foldl(0n, rest, (acc, y) => gcd(acc, ensureInteger(y))),
	);
	interp.def(
		"lcm",
		-1,
		"(lcm n...)",
		"Return the least common multiple of the integers (1 with no arguments).",
		z.tuple([zList]),
		([rest]) =>
			foldl(1n, rest, (acc, y) => {
				const n = ensureInteger(y);
				return acc === 0n || n === 0n ? 0n : bigAbs(acc * n) / gcd(acc, n);
			}),
	);
	interp.def(
		"parse-integer",
		1,
		"(parse-integer s)",
		'Parse the decimal integer in the string `s`, surrounding whitespace allowed: `(parse-integer " 42 ")` is 42. Errors if `s` holds anything else.',
		z.tuple([zString]),
		([s]) => {
			const t = s.trim();
			if (!/^[+-]?\d+$/.test(t))
				throw new EvalException("parse-integer: not an integer", s);
			return BigInt(t);
		},
	);
}

function installCollections(interp: Definer): void {
	interp.def(
		"make-hash-table",
		0,
		"(make-hash-table)",
		"Return a new empty hash table. Keys compare by equal, so strings, numbers and lists work as keys.",
		z.tuple([]),
		() => new LispHashTable(),
	);
	interp.def(
		"hash-table-p",
		1,
		"(hash-table-p x)",
		"Return t if `x` is a hash table.",
		z.tuple([zAny]),
		([x]) => (x instanceof LispHashTable ? true : null),
	);
	interp.def(
		"gethash",
		-3,
		"(gethash key table [default])",
		"Return the value stored under `key` in `table`, or `default` (nil if not given) when there is none.",
		z.tuple([zAny, zHashTable, zList]),
		([key, table, rest]) => {
			const hit = table.get(key);
			return hit === undefined ? (rest === null ? null : rest.car) : hit[1];
		},
	);
	interp.def(
		"hash-has-key",
		2,
		"(hash-has-key key table)",
		"Return t if `table` holds an entry for `key`, even one whose value is nil.",
		z.tuple([zAny, zHashTable]),
		([key, table]) => (table.get(key) === undefined ? null : true),
	);
	interp.def(
		"puthash",
		3,
		"(puthash key value table)",
		"Store `value` under `key` in `table`, destructively; return `value`.",
		z.tuple([zAny, zAny, zHashTable]),
		([key, value, table]) => {
			table.set(key, value);
			return value;
		},
	);
	interp.def(
		"remhash",
		2,
		"(remhash key table)",
		"Remove the entry for `key` from `table`; return t if there was one.",
		z.tuple([zAny, zHashTable]),
		([key, table]) => (table.delete(key) ? true : null),
	);
	interp.def(
		"clrhash",
		1,
		"(clrhash table)",
		"Remove every entry from `table`; return `table`.",
		z.tuple([zHashTable]),
		([table]) => {
			table.clear();
			return table;
		},
	);
	interp.def(
		"hash-table-count",
		1,
		"(hash-table-count table)",
		"Return the number of entries in `table`.",
		z.tuple([zHashTable]),
		([table]) => BigInt(table.size),
	);
	interp.def(
		"hash-table-keys",
		1,
		"(hash-table-keys table)",
		"Return a list of the keys of `table`, in insertion order.",
		z.tuple([zHashTable]),
		([table]) => arrayToList(table.pairs().map(([k]) => k)),
	);
	interp.def(
		"hash-table-values",
		1,
		"(hash-table-values table)",
		"Return a list of the values of `table`, in insertion order.",
		z.tuple([zHashTable]),
		([table]) => arrayToList(table.pairs().map(([, v]) => v)),
	);
	interp.def(
		"hash-table-alist",
		1,
		"(hash-table-alist table)",
		"Return the entries of `table` as an alist of (key . value) pairs, in insertion order.",
		z.tuple([zHashTable]),
		([table]) => arrayToList(table.pairs().map(([k, v]) => new Cell(k, v))),
	);

	interp.def(
		"vector",
		-1,
		"(vector x...)",
		"Return a new vector of the arguments. A vector is a fixed-position sequence with constant-time aref and aset.",
		z.tuple([zList]),
		([rest]) => new LispVector(listItems(rest)),
	);
	interp.def(
		"make-vector",
		-2,
		"(make-vector n [init])",
		"Return a new vector of `n` elements, each `init` (nil if not given).",
		z.tuple([zNumeric, zList]),
		([n, rest]) => {
			const size = Number(n);
			if (!Number.isInteger(size) || size < 0)
				throw new EvalException("make-vector: bad size", n);
			return new LispVector(
				new Array(size).fill(rest === null ? null : rest.car),
			);
		},
	);
	interp.def(
		"vectorp",
		1,
		"(vectorp x)",
		"Return t if `x` is a vector.",
		z.tuple([zAny]),
		([x]) => (x instanceof LispVector ? true : null),
	);
	interp.def(
		"aref",
		2,
		"(aref vector i)",
		"Return the element of `vector` at index `i`, counting from 0. Errors past the end.",
		z.tuple([zVector, zNumeric]),
		([v, i]) => v.items[indexIn(i, v.items.length)],
	);
	interp.def(
		"aset",
		3,
		"(aset vector i x)",
		"Destructively set the element of `vector` at index `i` to `x`; return `x`.",
		z.tuple([zVector, zNumeric, zAny]),
		([v, i, x]) => {
			v.items[indexIn(i, v.items.length)] = x;
			return x;
		},
	);
	interp.def(
		"vector-push",
		2,
		"(vector-push x vector)",
		"Append `x` to the end of `vector`, destructively; return the index it landed at.",
		z.tuple([zAny, zVector]),
		([x, v]) => BigInt(v.items.push(x) - 1),
	);
	interp.def(
		"vector-to-list",
		1,
		"(vector-to-list vector)",
		"Return a new list of the elements of `vector`.",
		z.tuple([zVector]),
		([v]) => arrayToList(v.items),
	);
	interp.def(
		"list-to-vector",
		1,
		"(list-to-vector list)",
		"Return a new vector of the elements of `list`.",
		z.tuple([zList]),
		([xs]) => new LispVector(listItems(xs)),
	);
}

function installSequences(interp: Definer): void {
	interp.def(
		"elt",
		2,
		"(elt seq i)",
		"Return the element at index `i` of a list, string or vector, counting from 0. Errors past the end.",
		z.tuple([zSequence, zNumeric]),
		([seq, i]) => {
			if (typeof seq === "string") return seq[indexIn(i, seq.length)];
			if (seq instanceof LispVector)
				return seq.items[indexIn(i, seq.items.length)];
			const items = listItems(seq);
			return items[indexIn(i, items.length)];
		},
	);
	interp.def(
		"subseq",
		-3,
		"(subseq seq start [end])",
		"Return a new list, string or vector of the elements of `seq` from `start` up to (not including) `end`, default the end. Errors on an index out of range.",
		z.tuple([zSequence, zNumeric, zList]),
		([seq, start, rest]) => {
			const items =
				typeof seq === "string"
					? seq
					: seq instanceof LispVector
						? seq.items
						: listItems(seq);
			const from = Number(start);
			const to = rest === null ? items.length : Number(ensureNum(rest.car));
			if (!(0 <= from && from <= to && to <= items.length))
				throw new EvalException("subseq: bad range", new Cell(start, rest));
			const part = items.slice(from, to);
			if (typeof part === "string") return part;
			return seq instanceof LispVector
				? new LispVector(part)
				: arrayToList(part);
		},
	);
}

function installChars(interp: Definer): void {
	interp.def(
		"char-code",
		1,
		"(char-code c)",
		"Return the Unicode code point of the one-character string `c`.",
		z.tuple([zChar]),
		([c]) => BigInt(c.codePointAt(0) as number),
	);
	interp.def(
		"code-char",
		1,
		"(code-char n)",
		"Return the one-character string for the Unicode code point `n`.",
		z.tuple([zNumeric]),
		([n]) => {
			const code = Number(n);
			if (!Number.isInteger(code) || code < 0 || code > 0x10ffff)
				throw new EvalException("code-char: not a code point", n);
			return String.fromCodePoint(code);
		},
	);
	interp.def(
		"digit-char-p",
		1,
		"(digit-char-p c)",
		"Return the digit value 0..9 of the one-character string `c`, or nil if it is not a digit.",
		z.tuple([zChar]),
		([c]) => (/^[0-9]$/.test(c) ? BigInt(c) : null),
	);
	interp.def(
		"alpha-char-p",
		1,
		"(alpha-char-p c)",
		"Return t if the one-character string `c` is a letter.",
		z.tuple([zChar]),
		([c]) => (/^\p{L}$/u.test(c) ? true : null),
	);
	interp.def(
		"whitespace-char-p",
		1,
		"(whitespace-char-p c)",
		"Return t if the one-character string `c` is whitespace.",
		z.tuple([zChar]),
		([c]) => (/^\s$/.test(c) ? true : null),
	);
}

function installStrings(interp: Definer): void {
	interp.def(
		"string<",
		2,
		"(string< s1 s2)",
		"Return t if `s1` sorts before `s2`, comparing code points.",
		z.tuple([zString, zString]),
		([a, b]) => (a < b ? true : null),
	);
	interp.def(
		"string>",
		2,
		"(string> s1 s2)",
		"Return t if `s1` sorts after `s2`, comparing code points.",
		z.tuple([zString, zString]),
		([a, b]) => (a > b ? true : null),
	);
	interp.def(
		"string-equal",
		2,
		"(string-equal s1 s2)",
		"Return t if `s1` and `s2` are equal ignoring case.",
		z.tuple([zString, zString]),
		([a, b]) => (a.toLowerCase() === b.toLowerCase() ? true : null),
	);
	for (const [name, side] of [
		["string-pad-left", "start"],
		["string-pad-right", "end"],
	] as const)
		interp.def(
			name,
			-3,
			`(${name} s width [pad])`,
			`Return \`s\` padded at the ${side} with \`pad\` (default a space) up to \`width\` characters; a longer \`s\` is returned unchanged.`,
			z.tuple([zString, zNumeric, zList]),
			([s, width, rest]) => {
				const pad = rest === null ? " " : rest.car;
				if (typeof pad !== "string" || pad === "")
					throw new EvalException("pad must be a non-empty string", pad);
				const n = Number(width);
				return side === "start" ? s.padStart(n, pad) : s.padEnd(n, pad);
			},
		);
	interp.def(
		"number-to-string",
		2,
		"(number-to-string n digits)",
		'Return `n` as a string with exactly `digits` digits after the point: `(number-to-string 3.14159 2)` is "3.14".',
		z.tuple([zNumeric, zNumeric]),
		([n, digits]) => {
			const d = Number(digits);
			if (!Number.isInteger(d) || d < 0 || d > 100)
				throw new EvalException(
					"number-to-string: digits out of range",
					digits,
				);
			return Number(n).toFixed(d);
		},
	);
}

function installNonLocalExits(interp: Definer, core: CoreOps): void {
	const active: [unknown, unknown][] = [];
	interp.defGen(
		"_catch",
		3,
		"(_catch kind tag thunk)",
		"Internal: call the 0-arg thunk; a `_throw` of the same kind and an eq tag inside it ends the call with the thrown value.",
		z.tuple([zAny, zAny, zAny]),
		function* ([kind, tag, thunk]) {
			active.push([kind, tag]);
			try {
				return yield* core.apply([thunk, null]);
			} catch (ex) {
				if (
					ex instanceof ThrowSignal &&
					ex.kind === kind &&
					Object.is(ex.tag, tag)
				)
					return ex.value;
				throw ex;
			} finally {
				active.pop();
			}
		},
	);
	interp.def(
		"_throw",
		3,
		"(_throw kind tag value)",
		"Internal: unwind to the nearest `_catch` of the same kind and an eq tag, which returns `value`.",
		z.tuple([zAny, zAny, zAny]),
		([kind, tag, value]) => {
			if (!active.some(([k, t]) => k === kind && Object.is(t, tag)))
				throw new EvalException(
					kind === newLispKeyword("block")
						? "return-from: no enclosing block named"
						: "throw: no catch for tag",
					tag,
				);
			throw new ThrowSignal(kind, tag, value);
		},
	);
	interp.defGen(
		"_unwind-protect",
		2,
		"(_unwind-protect thunk cleanup)",
		"Internal: call the 0-arg thunk and return its value, calling the 0-arg cleanup afterwards however the thunk exits.",
		z.tuple([zAny, zAny]),
		function* ([thunk, cleanup]) {
			try {
				return yield* core.apply([thunk, null]);
			} finally {
				yield* core.apply([cleanup, null]);
			}
		},
	);
}

export function installCore(interp: Definer, core: CoreOps): void {
	installNumbers(interp);
	installCollections(interp);
	installSequences(interp);
	installChars(interp);
	installStrings(interp);
	installNonLocalExits(interp, core);

	interp.def(
		"car",
		1,
		"(car list)",
		"Return the first element of `list`, or nil for nil.",
		z.tuple([zList]),
		([x]) => (x === null ? null : x.car),
	);
	interp.def(
		"cdr",
		1,
		"(cdr list)",
		"Return the rest of `list` after the first element, or nil for nil.",
		z.tuple([zList]),
		([x]) => (x === null ? null : x.cdr),
	);
	interp.def(
		"cons",
		2,
		"(cons x y)",
		"Return a new cons cell with `x` as car and `y` as cdr.",
		z.tuple([zAny, zAny]),
		([x, y]) => new Cell(x, y),
	);
	interp.def(
		"atom",
		1,
		"(atom x)",
		"Return t if `x` is not a cons cell (i.e. not a non-empty list).",
		z.tuple([zAny]),
		([x]) => (x instanceof Cell ? null : true),
	);
	interp.def(
		"eq",
		2,
		"(eq x y)",
		"Return t if `x` and `y` are the same object (identity).",
		z.tuple([zAny, zAny]),
		([x, y]) => (Object.is(x, y) ? true : null),
	);

	interp.def(
		"list",
		-1,
		"(list x...)",
		"Return a new list of the given elements.",
		z.tuple([zList]),
		([rest]) => rest,
	);
	interp.def(
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
	interp.def(
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
	interp.def(
		"length",
		1,
		"(length x)",
		"Return the length of a list, string or vector.",
		z.tuple([zSequence]),
		([x]) =>
			x === null
				? ZERO
				: quotient(x instanceof LispVector ? x.items.length : x.length, 1),
	);
	interp.def(
		"stringp",
		1,
		"(stringp x)",
		"Return t if `x` is a string.",
		z.tuple([zAny]),
		([x]) => (typeof x === "string" ? true : null),
	);
	interp.def(
		"keywordp",
		1,
		"(keywordp x)",
		"Return t if `x` is a keyword such as `:name`.",
		z.tuple([zAny]),
		([x]) => (x instanceof LispKeyword ? true : null),
	);
	interp.def(
		"numberp",
		1,
		"(numberp x)",
		"Return t if `x` is a number.",
		z.tuple([zAny]),
		([x]) => (isNumeric(x) ? true : null),
	);

	interp.def(
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

	interp.def(
		"<",
		2,
		"(< x y)",
		"Return t if `x` is numerically less than `y`.",
		z.tuple([zNumeric, zNumeric]),
		([x, y]) => (compare(x, y) < 0 ? true : null),
	);

	interp.def(
		"%",
		2,
		"(% x y)",
		"Return the remainder of `x` divided by `y`. Alias: `rem`.",
		z.tuple([zNumeric, zNumeric]),
		([x, y]) => remainder(x, y),
	);

	interp.def(
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

	interp.def(
		"+",
		-1,
		"(+ x...)",
		"Return the sum of the arguments (0 with no arguments).",
		z.tuple([zList]),
		([rest]) => foldl(ZERO, rest, (i, j) => add(i as Numeric, ensureNum(j))),
	);

	interp.def(
		"*",
		-1,
		"(* x...)",
		"Return the product of the arguments (1 with no arguments).",
		z.tuple([zList]),
		([rest]) =>
			foldl(ONE, rest, (i, j) => multiply(i as Numeric, ensureNum(j))),
	);

	interp.def(
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

	interp.def(
		"/",
		-3,
		"(/ x y...)",
		"Divide `x` by the remaining arguments.",
		z.tuple([zNumeric, zNumeric, zList]),
		([x, y, rest]) =>
			foldl(divide(x, y), rest, (i, j) => divide(i as Numeric, ensureNum(j))),
	);

	interp.def(
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

	interp.def(
		"echo",
		-1,
		"(echo x...)",
		"Print the arguments, separated by spaces and followed by a newline: strings as they are, everything else in re-readable form. `(echo)` alone prints a blank line. Returns an unspecified value, so the REPL reports nothing for a step that ends in an echo — what was printed IS the report.",
		z.tuple([zList]),
		([rest]) => {
			output.emit(interp.channels, { user: `${echoText(rest)}\n` });
			return Unspecified;
		},
	);
	interp.def("doc", -1, DOC_SIGNATURE, DOC_DOC, z.tuple([zList]), ([rest]) => {
		const answer = lookupDoc(interp, rest);
		output.emit(interp.channels, { user: answer.text, model: answer.text });
		return answer.value;
	});
	interp.def(
		"_set-source",
		2,
		"(_set-source 'name form)",
		"Record `form` as the definition of `name`; return `name`.",
		z.tuple([zAny, zAny]),
		([name, form]) => {
			if (name instanceof Sym) interp.setSource(name.name, form);
			return name;
		},
	);
	interp.def(
		"makunbound",
		1,
		"(makunbound 'name)",
		"Remove the global `name` with its documentation and source, undoing `setq`, `defun` or `defmacro` at top level. Return t if it was bound, nil otherwise. A builtin and a read-only global stay.",
		z.tuple([zSym]),
		([sym]) => {
			const owner = interp.ownerOf(sym);
			if (owner !== undefined)
				throw new EvalException(
					`read-only global owned by ${owner}`,
					sym,
					false,
				);
			const value = interp.getGlobal(sym);
			if (value === undefined) return null;
			if (value instanceof BuiltInFunc)
				throw new EvalException("a builtin cannot be unbound", sym, false);
			interp.undefineGlobal(sym);
			return true;
		},
	);

	const gensymCounter = newSym("*gensym-counter*");
	interp.defineGlobal(gensymCounter, ONE, {
		signature: "*gensym-counter*",
		doc: "Counter used by `gensym` to name fresh symbols.",
	});
	interp.def(
		"gensym",
		0,
		"(gensym)",
		"Return a new uninterned symbol (G1, G2, ...).",
		z.tuple([]),
		() => {
			const i = interp.getGlobal(gensymCounter) as Numeric;
			interp.defineGlobal(gensymCounter, add(i, ONE));
			return new Sym(`G${i}`);
		},
	);

	interp.def(
		"make-symbol",
		1,
		"(make-symbol name)",
		"Return a new uninterned symbol named `name`.",
		z.tuple([zString]),
		([name]) => new Sym(name),
	);
	interp.def(
		"intern",
		1,
		"(intern name)",
		"Return the interned symbol named `name`.",
		z.tuple([zString]),
		([name]) => newSym(name),
	);
	interp.def(
		"symbol-name",
		1,
		"(symbol-name sym)",
		"Return the name of `sym` as a string.",
		z.tuple([zSym]),
		([sym]) => sym.name,
	);

	interp.def(
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
	interp.def(
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
	interp.def(
		"string",
		1,
		"(string x)",
		'Convert `x` to a string: its printed form, with a string left as itself rather than quoted. `(string 12)` is "12", `(string \'foo)` is "foo", `(string nil)` is "nil". Numbers keep the exact/inexact distinction, so `(string 3.0)` is "3.0", not "3".',
		z.tuple([zAny]),
		([x]) => str(x, false),
	);
	interp.def(
		"string-upcase",
		1,
		"(string-upcase s)",
		"Return `s` with all letters converted to upper case.",
		z.tuple([zString]),
		([s]) => s.toUpperCase(),
	);
	interp.def(
		"string-downcase",
		1,
		"(string-downcase s)",
		"Return `s` with all letters converted to lower case.",
		z.tuple([zString]),
		([s]) => s.toLowerCase(),
	);

	interp.def(
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
	interp.def(
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
					(ex as SyntaxError).message,
					false,
				);
			}
		},
	);

	interp.defGen(
		"apply",
		2,
		"(apply f args)",
		"Call `f` with the elements of the list `args` as its arguments.",
		z.tuple([zAny, zList]),
		(a) => core.apply(a),
	);

	interp.def(
		"exit",
		1,
		"(exit code)",
		"Exit the process with the given status code.",
		z.tuple([zNumeric]),
		([code]) => exit(Number(code)),
	);
	interp.defGen(
		"import",
		1,
		'(import "path")',
		"Read the Lisp file at `path` and evaluate it in the current environment, so its definitions become available here (import * from the file). Relative paths resolve against the importing file's directory. Circular imports are skipped. Returns nil.",
		z.tuple([zString]),
		([path]) => core.importFile(path),
	);
	interp.def(
		"dump",
		0,
		"(dump)",
		"Return a list of all global symbols.",
		z.tuple([]),
		() => {
			let s: List = null;
			for (const [x] of interp.globalEntries()) s = new Cell(x, s);
			return s;
		},
	);

	interp.defineGlobal(
		newSym("*version*"),
		new Cell(2.1, new Cell("TypeScript", new Cell("Lisptc", null))),
		{
			signature: "*version*",
			doc: "The interpreter version: (number implementation-language name).",
		},
	);

	interp.def(
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
				const tokens =
					typeof argsOrSig === "string" ? undefined : listToStrings(argsOrSig);
				const sig =
					tokens === undefined
						? (argsOrSig as string)
						: `(${[sym.name, ...tokens].join(" ")})`;
				interp.setDoc(sym.name, {
					signature: sig,
					doc: docstring,
					args: tokens === undefined ? undefined : keywordArgsIn(tokens),
				});
			}
			return sym;
		},
	);

	interp.def(
		"error",
		1,
		"(error value)",
		"Signal a catchable error carrying `value`. A `(try ... (catch (e) ...))` wrapping the call binds `e` to `value` exactly (any Lisp value, not just a string).",
		z.tuple([zAny]),
		([value]) => {
			throw new EvalException("error", value, true);
		},
	);
	interp.def(
		"break",
		0,
		"(break)",
		"Exit the nearest enclosing while/dolist/dotimes loop immediately; the loop evaluates to nil.",
		z.tuple([]),
		() => {
			throw new LoopSignal(null);
		},
	);
	interp.def(
		"return",
		1,
		"(return value)",
		"Exit the nearest enclosing while/dolist/dotimes loop immediately; the loop evaluates to value.",
		z.tuple([zAny]),
		([value]) => {
			throw new LoopSignal(value);
		},
	);
	interp.defGen(
		"_run-loop-body",
		1,
		"(_run-loop-body thunk)",
		"Internal: call the 0-arg thunk, catching only a break/return loop signal (any other exception, including a genuine Lisp error, propagates unchanged). Returns (signalled? . value): signalled? is t iff break/return fired.",
		z.tuple([zAny]),
		(a) => core.runLoopBody(a),
	);
}
