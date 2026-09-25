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
import {
	DOC_DOC,
	DOC_SIGNATURE,
	type Doc,
	type DocArg,
	type DocSource,
	lookupDoc,
} from "./docs.ts";
import type { Eval } from "./drive.ts";
import { EvalException, LoopSignal } from "./errors.ts";
import {
	Cell,
	EndOfFile,
	foldl,
	jsonToLisp,
	type List,
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
	globalEntries(): IterableIterator<[Sym, unknown]>;
	setDoc(name: string, doc: Doc): void;
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

function listToStrings(list: List): string[] {
	const out: string[] = [];
	for (let c = list; c !== null; c = c.cdr as Cell | null) out.push(str(c.car));
	return out;
}

export function installCore(interp: Definer, core: CoreOps): void {
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
		"Return the length of a list or string.",
		z.tuple([
			z.custom<Cell | string | null>(
				(x) => x === null || x instanceof Cell || typeof x === "string",
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
		z.tuple([zAny]),
		([x]) => (typeof x === "string" ? true : null),
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
					ex instanceof Error ? ex.message : String(ex),
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
				const sig =
					typeof argsOrSig === "string"
						? argsOrSig
						: `(${[sym.name, ...listToStrings(argsOrSig)].join(" ")})`;
				interp.setDoc(sym.name, { signature: sig, doc: docstring });
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
