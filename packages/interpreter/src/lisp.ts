/*
  Lisptc — derived from Nukata Lisp 2.1.0 in TypeScript 4.6 by SUZUKI Hisao (H28.02.08/R04.03.28)
*/

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
import { registerMcp } from "./mcp.ts";

// An inefficient substitution of assert statement in Dart
function assert(x: boolean, message?: string): asserts x {
	if (!x) throw new Error(`Assertion Failure: ${message || ""}`);
}

// Output string s (a new line on \n char). Defaults to a no-op so the
// interpreter can be imported (e.g. by tests) without a running REPL; the
// CLI entry point (src/cli.ts) wires these to stdout/process.exit via
// setWriter()/setExit() below.
let write: (s: string) => void = () => {};
let exit: (n: number) => void = () => {}; // Terminate the process with exit code n.

// Redirect interpreter output (used by prin1/princ/terpri). Returns the
// previous writer so callers can restore it.
export function setWriter(fn: (s: string) => void): (s: string) => void {
	const prev = write;
	write = fn;
	return prev;
}

// Wire the `(exit code)` built-in to a real process-exit. Defaults to a no-op
// so importing the interpreter never terminates the host; the CLI sets it.
export function setExit(fn: (n: number) => void): void {
	exit = fn;
}

// REPL usage text, printed by the (help) built-in on demand.
const HELP_TEXT = `Lisptc REPL — special keystrokes & commands:
  Up/Down arrows : browse input history (previous / next line)
  :up            : re-enter the previous input line (works when piped, too)
  :clear / clear : clear the screen and re-prompt
  Ctrl-C         : cancel the current input line
  Ctrl-D (EOF)   : exit the REPL`;

//----------------------------------------------------------------------

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
function foldl<T>(x: T, j: List, fn: (x: T, y: unknown) => T): T {
	while (j !== null) {
		x = fn(x, j.car);
		j = j.cdr as List;
	}
	return x;
}

// mapcar((a b c), fn) => (fn(a) fn(b) fn(c))
function mapcar(j: List, fn: (x: unknown) => unknown): List {
	if (j === null) return null;
	const a = fn(j.car);
	let d = j.cdr;
	if (d instanceof Cell) d = mapcar(d, fn);
	if (Object.is(j.car, a) && Object.is(j.cdr, d)) return j;
	return new Cell(a, d);
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
class Keyword extends Sym {}

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

const backQuoteSym = newSym("`");
const commaAtSym = newSym(",@");
const commaSym = newSym(",");
const dotSym = newSym(".");
const leftParenSym = newSym("(");
const rightParenSym = newSym(")");
const singleQuoteSym = newSym("'");

const appendSym = newSym("append");
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

//----------------------------------------------------------------------

// Get cdr of list x as a Cell or null.
function cdrCell(x: Cell): List {
	const k = x.cdr;
	if (k instanceof Cell) return k;
	else if (k === null) return null;
	else throw new EvalException("proper list expected", x);
}

// Assert that x is a number, throwing an EvalException otherwise. Used to
// guard the arithmetic/comparison built-ins against non-numeric arguments.
function ensureNum(x: unknown): Numeric {
	if (isNumeric(x)) return x;
	throw new EvalException("not a number", x);
}

// Zod schemas for the arguments of built-in functions. Validation failures
// are surfaced as EvalException via parseArgs, matching the historical
// hand-written checks (e.g. "list expected", "not a number").
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

// Validate a built-in's argument frame against a tuple schema, throwing an
// EvalException that names the offending argument on failure.
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

// Common base class of Lisp functions
abstract class Func {
	// carity is a number of arguments, made negative if the func has &rest.
	constructor(public readonly carity: number) {}

	get arity(): number {
		return this.carity < 0 ? -this.carity : this.carity;
	}

	get hasRest(): boolean {
		return this.carity < 0;
	}

	get fixedArgs(): number {
		// Number of fixed arguments
		return this.carity < 0 ? -this.carity - 1 : this.carity;
	}

	// Make a call-frame from a list of actual arguments.
	makeFrame(arg: List): unknown[] {
		const frame = new Array(this.arity);
		const n = this.fixedArgs;
		let i = 0;
		for (; i < n && arg !== null; i++) {
			// Set the list of fiexed args.
			frame[i] = arg.car;
			arg = cdrCell(arg);
		}
		if (i !== n || (arg !== null && !this.hasRest))
			throw new EvalException("arity not matched", this);
		if (this.hasRest) frame[n] = arg;
		return frame;
	}

	// Evaluate each expression of a frame.
	evalFrame(frame: unknown[], interp: Interp, env: List): void {
		const n = this.fixedArgs;
		for (let i = 0; i < n; i++) frame[i] = interp.eval(frame[i], env);
		if (this.hasRest && frame[n] instanceof Cell) {
			let z: List = null;
			let y: List = null;
			for (let j = frame[n] as List; j !== null; j = cdrCell(j)) {
				const e = interp.eval(j.car, env);
				const x = new Cell(e, null);
				if (z === null) {
					z = x;
				} else {
					assert(y !== null);
					y.cdr = x;
				}
				y = x;
			}
			frame[n] = z;
		}
	}
}

// Common base class of functions which are defined with Lisp expressions
abstract class DefinedFunc extends Func {
	// body is a Lisp list as the function body.
	constructor(
		carity: number,
		public readonly body: List,
	) {
		super(carity);
	}
}

// Common function type which represents any factory methods of DefinedFunc
type FuncFactory = (carity: number, body: List, env: List) => DefinedFunc;

// Compiled macro expression
class Macro extends DefinedFunc {
	toString(): string {
		return `#<macro:${this.carity}:${str(this.body)}>`;
	}

	// Expand the macro with a list of actual arguments.
	expandWith(interp: Interp, arg: List): unknown {
		const frame = this.makeFrame(arg);
		const env = new Cell(frame, null);
		let x: unknown = null;
		for (let j = this.body; j !== null; j = cdrCell(j))
			x = interp.eval(j.car, env);
		return x;
	}

	static make(carity: number, body: List, env: List): DefinedFunc {
		assert(env === null);
		return new Macro(carity, body);
	}
}

// Compiled lambda expression (within another function)
class Lambda extends DefinedFunc {
	toString(): string {
		return `#<lambda:${this.carity}:${str(this.body)}>`;
	}

	static make(carity: number, body: List, env: List): DefinedFunc {
		assert(env === null);
		return new Lambda(carity, body);
	}
}

// Compiled lambda expression (Closure with environment)
class Closure extends DefinedFunc {
	// env is the environment of the closure.
	constructor(
		carity: number,
		body: List,
		private readonly env: List,
	) {
		super(carity, body);
	}

	static makeFrom(x: Lambda, env: List) {
		return new Closure(x.carity, x.body, env);
	}

	toString(): string {
		return `#<closure:${this.carity}:${str(this.env)}:${str(this.body)}>`;
	}

	// Make a new environment from a list of actual arguments.
	makeEnv(interp: Interp, arg: List, interpEnv: List): Cell {
		const frame = this.makeFrame(arg);
		this.evalFrame(frame, interp, interpEnv);
		return new Cell(frame, this.env); // Prepend the frame to the env.
	}

	static make(carity: number, body: List, env: List): DefinedFunc {
		return new Closure(carity, body, env);
	}
}

// Function type which represents any built-in function bodies
type BuiltInFuncBody = (frame: unknown[]) => unknown;

// Built-in function
class BuiltInFunc extends Func {
	// name is the function name; body is the function body.
	constructor(
		private readonly name: string,
		carity: number,
		private readonly body: BuiltInFuncBody,
	) {
		super(carity);
	}

	toString(): string {
		return `#<${this.name}:${this.carity}>`;
	}

	// Invoke the built-in function with a list of actual arguments.
	evalWith(interp: Interp, arg: List, interpEnv: List): unknown {
		const frame = this.makeFrame(arg);
		this.evalFrame(frame, interp, interpEnv);
		try {
			return this.body(frame);
		} catch (ex) {
			if (ex instanceof EvalException) throw ex;
			else throw new EvalException(`${ex} -- ${this.name}`, frame);
		}
	}
}

// Bound variable in a compiled lambda/macro expression
class Arg {
	constructor(
		public readonly level: number,
		public readonly offset: number,
		public readonly symbol: Sym,
	) {}

	toString(): string {
		return `#${this.level}:${this.offset}:${this.symbol}`;
	}

	// Set a value x to the location corresponding to the variable in env.
	setValue(x: unknown, env: Cell): void {
		for (let i = 0; i < this.level; i++) env = env.cdr as Cell;
		(env.car as unknown[])[this.offset] = x;
	}

	// Get a value from the location corresponding to the variable in env.
	getValue(env: Cell): unknown {
		for (let i = 0; i < this.level; i++) env = env.cdr as Cell;
		return (env.car as unknown[])[this.offset];
	}
}

// Exception in evaluation
export class EvalException extends Error {
	readonly trace: string[] = [];

	constructor(msg: string, x: unknown, quoteString = true) {
		super(`${msg}: ${str(x, quoteString)}`);
	}

	toString(): string {
		let s = `EvalException: ${this.message}`;
		for (const line of this.trace) s += `\n\t${line}`;
		return s;
	}
}

// Exception which indicates an absence of a variable
class NotVariableException extends EvalException {
	constructor(x: unknown) {
		super("variable expected", x);
	}
}

// Exception thrown when something does not have an expected format
class FormatException extends Error {}

// Singleton for end-of-file
export const EndOfFile = { toString: () => "EOF" };

//----------------------------------------------------------------------

// Core of the interpreter
// Documentation of a binding: a call signature and a one-line description.
export interface Doc {
	signature: string;
	doc: string;
}

// Docs for the special forms (keywords handled directly by the evaluator)
// and reader constants. These are not global bindings, so they are kept
// here, next to the evaluator that implements them.
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
	t: { signature: "t", doc: "The canonical true value." },
	nil: { signature: "nil", doc: "The empty list / false value." },
};

// Printed representations of a list's elements (for building signatures).
function listToStrings(list: List): string[] {
	const out: string[] = [];
	for (let c = list; c !== null; c = c.cdr as Cell | null) out.push(str(c.car));
	return out;
}

export class Interp {
	// Table of the global values of symbols
	private readonly globals: Map<Sym, unknown> = new Map();

	// Documentation of global bindings, keyed by name. Populated alongside
	// each definition (def / defineGlobal / the _set-doc built-in) so docs
	// cannot drift from the bindings they describe.
	private readonly docTable: Map<string, Doc> = new Map();

	// Names of all global bindings (built-ins, prelude defs, MCP tools).
	globalNames(): string[] {
		return [...this.globals.keys()].map((s) => s.name);
	}

	// Documentation for every documented binding plus the special forms.
	docs(): Map<string, Doc> {
		return new Map([...Object.entries(specialFormDocs), ...this.docTable]);
	}

	constructor() {
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
				return x === y
					? true
					: isNumeric(x) && isNumeric(y) && compare(x, y) === 0
						? true
						: null;
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
			"prin1",
			1,
			"(prin1 x)",
			"Print `x` in re-readable form (strings quoted); return `x`.",
			z.tuple([zAny]),
			([x]) => {
				write(str(x, true));
				return x;
			},
		);
		this.def(
			"princ",
			1,
			"(princ x)",
			"Print `x` in human-readable form (strings unquoted); return `x`.",
			z.tuple([zAny]),
			([x]) => {
				write(str(x, false));
				return x;
			},
		);
		this.def(
			"terpri",
			0,
			"(terpri)",
			"Print a newline; return t.",
			z.tuple([]),
			() => {
				write("\n");
				return true;
			},
		);
		this.def(
			"help",
			0,
			"(help)",
			"Print the REPL usage text.",
			z.tuple([]),
			() => {
				write(`${HELP_TEXT}\n`);
				return true;
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
				return new Sym(`G${i}`); // an uninterned symbol
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
			"apply",
			2,
			"(apply f args)",
			"Call `f` with the elements of the list `args` as its arguments.",
			z.tuple([zAny, zList]),
			([f, args]) => this.eval(new Cell(f, mapcar(args, qqQuote)), null),
		);

		this.def(
			"exit",
			1,
			"(exit code)",
			"Exit the process with the given status code.",
			z.tuple([zNumeric]),
			([code]) => exit(Number(code)),
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

		// Register documentation for a Lisp-defined binding. Called by the
		// defun/defmacro expansions in the prelude, so a definition and its
		// docs always travel together. The second argument is either the
		// argument list of the definition (the signature is derived from it)
		// or a ready-made signature string (used for aliases).
		this.def(
			"_set-doc",
			3,
			"(_set-doc 'name args-or-signature docstring)",
			"Register documentation for the binding `name`; return `name`.",
			z.tuple([
				// Usually a Sym, but a defun nested in a lambda passes the
				// compiled local variable instead — tolerated and skipped below.
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

		// Install native MCP built-ins (load-mcp, unload-mcp, list-tools, ...).
		registerMcp(this);
	}

	// Define a built-in function by giving a name, a carity, documentation
	// (a call signature and a one-line description), a zod schema for the
	// argument frame, and a body. The frame is validated against the schema
	// before the body runs, so the body receives typed arguments. Docs are a
	// required argument so a built-in cannot be added without them.
	def<T extends z.ZodType>(
		name: string,
		carity: number,
		signature: string,
		doc: string,
		schema: T,
		body: (a: z.infer<T>) => unknown,
	) {
		const wrapped: BuiltInFuncBody = (a) => body(parseArgs(schema, a));
		this.globals.set(newSym(name), new BuiltInFunc(name, carity, wrapped));
		this.docTable.set(name, { signature, doc });
	}

	// Define/undefine a global binding. Used by the MCP layer to install and
	// remove per-tool wrapper functions at runtime (see src/mcp.ts).
	defineGlobal(sym: Sym, value: unknown, doc?: Doc): void {
		this.globals.set(sym, value);
		if (doc !== undefined) this.docTable.set(sym.name, doc);
	}

	undefineGlobal(sym: Sym): void {
		// A missing binding makes eval raise "void variable" (see below), so
		// deletion cleanly unbinds the symbol.
		this.globals.delete(sym);
		this.docTable.delete(sym.name);
	}

	hasGlobal(sym: Sym): boolean {
		return this.globals.has(sym);
	}

	// Build a BuiltInFunc without binding it (for wrappers stored elsewhere).
	makeBuiltIn(name: string, carity: number, body: BuiltInFuncBody): unknown {
		return new BuiltInFunc(name, carity, body);
	}

	// Evaluate a Lisp expression in an environment.
	eval(x: unknown, env: List): unknown {
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
								x = this.evalProgN(arg, env);
								break;
							case condSym:
								x = this.evalCond(arg, env);
								break;
							case setqSym:
								return this.evalSetQ(arg, env);
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
						// Application of a function
						// Expand fn = eval(fn, env) here on Sym for speed.
						if (fn instanceof Sym) {
							fn = this.globals.get(fn);
							if (fn === undefined) throw new EvalException("undefined", x.car);
						} else {
							fn = this.eval(fn, env);
						}

						if (fn instanceof Closure) {
							env = fn.makeEnv(this, arg, env);
							x = this.evalProgN(fn.body, env);
						} else if (fn instanceof Macro) {
							x = fn.expandWith(this, arg);
						} else if (fn instanceof BuiltInFunc) {
							return fn.evalWith(this, arg, env);
						} else {
							throw new EvalException("not applicable", fn);
						}
					}
				} else if (x instanceof Lambda) {
					return Closure.makeFrom(x, env);
				} else {
					return x; // numbers, strings, keywords (:foo), null etc.
				}
			}
		} catch (ex) {
			if (ex instanceof EvalException) {
				if (ex.trace.length < 10) ex.trace.push(str(x));
			}
			throw ex;
		}
	}

	// (progn E1 E2 .. En) => Evaluate E1, E2, .. except for En and return it.
	private evalProgN(j: List, env: List): unknown {
		if (j === null) return null;
		for (;;) {
			const x = j.car;
			j = cdrCell(j);
			if (j === null) return x; // The tail exp will be evaluated at the caller.
			this.eval(x, env);
		}
	}

	// Evaluate a conditional expression and return the selection unevaluated.
	private evalCond(j: List, env: List): unknown {
		for (; j !== null; j = cdrCell(j)) {
			const clause = j.car;
			if (clause instanceof Cell) {
				const result = this.eval(clause.car, env);
				if (result !== null) {
					// If the condition holds
					const body = cdrCell(clause);
					if (body === null) return qqQuote(result);
					else return this.evalProgN(body, env);
				}
			} else if (clause !== null) {
				throw new EvalException("cond test expected", clause);
			}
		}
		return null; // No clause holds.
	}

	// (setq V1 E1 ..) => Evaluate Ei and assign it to Vi; return the last.
	private evalSetQ(j: List, env: List): unknown {
		let result: unknown = null;
		for (; j !== null; j = cdrCell(j)) {
			const lval = j.car;
			j = cdrCell(j);
			if (j === null) throw new EvalException("right value expected", lval);
			result = this.eval(j.car, env);
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

	// Compile a Lisp list (macro ..) or (lambda ..).
	private compile(arg: List, env: List, make: FuncFactory): DefinedFunc {
		if (arg === null) throw new EvalException("arglist and body expected", arg);
		const table = new Map<Sym, Arg>();
		const [hasRest, arity] = makeArgTable(arg.car, table);
		let body = cdrCell(arg);
		body = scanForArgs(body, table) as List;
		// Expand macros up to 20 nestings
		body = this.expandMacros(body, 20) as List;
		body = this.compileInners(body) as List;
		return make(hasRest ? -arity : arity, body, env);
	}

	// Expand macros and quasi-quotations in an expression.
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
				default:
					if (k instanceof Sym) k = this.globals.get(k);
					if (k instanceof Macro) {
						const d = cdrCell(j);
						const z = k.expandWith(this, d);
						return this.expandMacros(z, count - 1);
					}
					return mapcar(j, (x) => this.expandMacros(x, count));
			}
		} else {
			return j;
		}
	}

	// Replace inner lambda expressions with Lambda instances.
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

//----------------------------------------------------------------------

// Make an argument table; return a pair of rest-yes/no and the arity.
function makeArgTable(arg: unknown, table: Map<Sym, Arg>): [boolean, number] {
	if (arg === null) {
		return [false, 0];
	} else if (arg instanceof Cell) {
		let ag = arg as List;
		let offset = 0; // offset value within the call-frame
		let hasRest = false;
		for (; ag !== null; ag = cdrCell(ag)) {
			let j = ag.car;
			if (hasRest) throw new EvalException("2nd rest", j);
			if (j === restSym) {
				// &rest var
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

// Scan 'j' for formal arguments in 'table' and replace them with Args.
// And scan 'j' for free Args not in 'table' and promote their levels.
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

// Scan for quasi-quotes and scanForArgs them depending on the nesting level.
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

//----------------------------------------------------------------------
// Quasi-Quotation

// Expand x of any quasi-quotation `x into the equivalent S-expression.
function qqExpand(x: unknown): unknown {
	return qqExpand0(x, 0); // Begin with the nesting level 0.
}

function qqExpand0(x: unknown, level: number): unknown {
	if (x instanceof Cell) {
		if (x.car === unquoteSym) {
			// ,a
			if (level === 0) return (x.cdr as Cell).car; // ,a => a
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

// Quote x so that the result evaluates to x.
function qqQuote(x: unknown): unknown {
	if (x instanceof Sym || x instanceof Cell)
		return new Cell(quoteSym, new Cell(x, null));
	return x;
}

// Expand x of `x so that the result can be used as an argument of append.
// Example 1: (,a b) => ((list a 'b))
// Example 2: (,a ,@(cons 2 3)) => ((cons a (cons 2 3)))
function qqExpand1(x: unknown, level: number): Cell {
	if (x instanceof Cell) {
		if (x.car === unquoteSym) {
			// ,a
			if (level === 0) return x.cdr as Cell; // ,a => (a)
			level--;
		} else if (x.car === quasiquoteSym) {
			// `a
			level++;
		}
		const h = qqExpand2(x.car, level);
		const t = qqExpand1(x.cdr, level); // !== null
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

// (1 2), (3 4) => (1 2 3 4)
function qqConcat(x: Cell, y: unknown): unknown {
	if (x === null) return y;
	return new Cell(x.car, qqConcat(x.cdr as Cell, y));
}

// (1 2 3), "a" => (cons 1 (cons 2 (cons 3 "a")))
function qqConsCons(x: Cell, y: unknown): unknown {
	if (x === null) return y;
	return new Cell(
		consSym,
		new Cell(x.car, new Cell(qqConsCons(x.cdr as Cell, y), null)),
	);
}

// Expand x.car (=y) of `x so that the result can be used as an arg of append.
// Example: ,a => (list a); ,@(foo 1 2) => (foo 1 2); b => (list 'b)
function qqExpand2(y: unknown, level: number): unknown {
	if (y instanceof Cell) {
		switch (y.car) {
			case unquoteSym: // ,a
				if (level === 0) return new Cell(listSym, y.cdr); // ,a => (list a)
				level--;
				break;
			case unquoteSplicingSym: // ,@a
				if (level === 0) return (y.cdr as Cell).car; // ,@a => a
				level--;
				break;
			case quasiquoteSym: // `a
				level++;
				break;
		}
	}
	return new Cell(listSym, new Cell(qqExpand0(y, level), null));
}

//----------------------------------------------------------------------

// A list of tokens, which works as a reader of Lisp expressions
export class Reader {
	private token: unknown;
	private tokens: string[] = [];
	private lineNo = 1;

	// Split a text into a list of tokens and append it to this.tokens.
	// For "(a \n 1)" it appends ["(", "a", "\n", "1", ")", "\n"] to tokens.
	push(text: string): void {
		const tokenPat = /\s+|;.*$|("(\\.?|.)*?"|,@?|[^()'`~"; \t]+|.)/g;
		for (const line of text.split("\n")) {
			for (;;) {
				const result = tokenPat.exec(line);
				if (result === null) break;
				const s = result[1];
				if (s !== undefined) this.tokens.push(s);
				else if (result[0].startsWith(";"))
					write(`Warning: comments are not allowed; ignored: ${result[0]}\n`);
			}
			this.tokens.push("\n");
		}
	}

	// 1-based line number of the token last consumed.
	get line(): number {
		return this.lineNo;
	}

	// Make this be a clone of the other.
	copyFrom(other: Reader): void {
		this.tokens = other.tokens.slice();
		this.lineNo = other.lineNo;
	}

	// Make this have no tokens.
	clear(): void {
		this.tokens.length = 0;
	}

	// Does this have no tokens?
	isEmpty(): boolean {
		return this.tokens.every((t: string) => t === "\n");
	}

	// Read a Lisp expression; throw EndOfFile if this.tokens run out.
	read(): unknown {
		try {
			this.readToken();
			return this.parseExpression();
		} catch (ex) {
			if (ex === EndOfFile) throw EndOfFile;
			else if (ex instanceof FormatException)
				throw new EvalException(
					"syntax error",
					`${ex.message} at ${this.lineNo}`,
					false,
				);
			else throw ex;
		}
	}

	private parseExpression(): unknown {
		switch (this.token) {
			case leftParenSym: // (a b c)
				this.readToken();
				return this.parseListBody();
			case singleQuoteSym: // 'a => (quote a)
				this.readToken();
				return new Cell(quoteSym, new Cell(this.parseExpression(), null));
			case backQuoteSym: // `a => (quasiquote a)
				this.readToken();
				return new Cell(quasiquoteSym, new Cell(this.parseExpression(), null));
			case commaSym: // ,a => (unquote a)
				this.readToken();
				return new Cell(unquoteSym, new Cell(this.parseExpression(), null));
			case commaAtSym: // ,@a => (unquote-splicing a)
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
				// (a . b)
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

	// Read the next token and set it to this.token.
	private readToken(): void {
		for (;;) {
			const t = this.tokens.shift();
			if (t === undefined) {
				throw EndOfFile;
			} else if (t === "\n") {
				this.lineNo += 1;
			} else if (t === "+" || t === "-") {
				// N.B. BigInt("+") and BigInt("-") return 0n in Safari.
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
					// Self-evaluating keyword literal, e.g. :query
					this.token = newLispKeyword(t.slice(1));
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

//----------------------------------------------------------------------

// Mapping from a quote symbol to its string representation
const quotes: { [key: string]: string } = {
	[quoteSym.name]: "'",
	[quasiquoteSym.name]: "`",
	[unquoteSym.name]: ",",
	[unquoteSplicingSym.name]: ",@",
};

// Make a string representation of Lisp expression
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

// Make a string representation of list, omitting its "(" and ")".
function strListBody(x: Cell, count?: number, printed?: Cell[]): string {
	if (printed === undefined) printed = [];
	if (count === undefined) count = 4; // threshold of ellipsis for circular lists
	const s: string[] = [];
	let y: unknown;
	for (y = x; y instanceof Cell; y = y.cdr) {
		if (printed.indexOf(y) < 0) {
			printed.push(y);
			count = 4;
		} else {
			count--;
			if (count < 0) {
				s.push("..."); // an ellipsis for a circular list
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

//----------------------------------------------------------------------

// Evaluate a string as a list of Lisp exps; return the result of the last exp.
export function run(interp: Interp, text: string): unknown {
	const tokens = new Reader();
	tokens.push(text);
	let result: unknown;
	while (!tokens.isEmpty()) {
		const exp = tokens.read();
		result = interp.eval(exp, null);
	}
	return result;
}

// A syntax error found by checkSyntax, with the 1-based line it was found at.
export interface SyntaxError_ {
	message: string;
	line: number;
}

// Parse (but do not evaluate) a whole program, returning any syntax errors.
// Stops at the first error since the token stream is unreliable past it.
export function checkSyntax(text: string): SyntaxError_[] {
	const tokens = new Reader();
	tokens.push(text);
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

// Lisp initialization script
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
(defun print (x)
  "Print x via prin1 followed by a newline; return x." (prin1 x) (terpri) x)
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
  (let (vars setqs)
    (defun vars (x)
      (cond (x (cons (caar x)
                     (vars (cdr x))))))
    (defun sets (x)
      (cond (x (cons \`(setq ,(caar x) ,(cadar x))
                     (sets (cdr x))))))
    \`(let ,(vars args) ,@(sets args) ,@body)))

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
  "Loop: evaluate body while test is non-nil; return nil."
  (let ((loop (gensym)))
    \`(letrec ((,loop (lambda () (cond (,test ,@body (,loop))))))
       (,loop))))

(defmacro dolist (spec &rest body)
  "Evaluate body with name (car of spec) bound to each element of the list (cadr of spec); return the optional third element of spec."
  (let ((name (car spec))
        (list (gensym)))
    \`(let (,name
           (,list ,(cadr spec)))
       (while ,list
         (setq ,name (car ,list))
         ,@body
         (setq ,list (cdr ,list)))
       ,@(if (cddr spec)
             \`((setq ,name nil)
               ,(caddr spec))))))

(defmacro dotimes (spec &rest body)
  "Evaluate body with name (car of spec) bound to 0..count-1; return the optional third element of spec."
  (let ((name (car spec))
        (count (gensym)))
    \`(let ((,name 0)
           (,count ,(cadr spec)))
       (while (< ,name ,count)
         ,@body
         (setq ,name (+ ,name 1)))
       ,@(if (cddr spec)
             \`(,(caddr spec))))))
`;
