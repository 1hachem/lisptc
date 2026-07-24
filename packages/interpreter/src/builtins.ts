/*
 * Registration of the native built-in functions, grouped by concern.
 * Called once from the Interp constructor; MCP built-ins are registered
 * separately (see mcp/index.ts).
 */
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
import { qqQuote } from "./compile.ts";
import { EvalException } from "./exceptions.ts";
import { formatSignature, type Interp } from "./interp.ts";
import { exit, write } from "./io.ts";
import { str } from "./printer.ts";
import { zAny, zCell, zList, zNumeric, zString, zSym } from "./schemas.ts";
import { Cell, foldl, type List, mapList, newSym, Sym } from "./sexpr.ts";

// REPL usage text, printed by the (help) built-in on demand.
const HELP_TEXT = `Lisptc REPL — special keystrokes & commands:
  Up/Down arrows : browse input history (previous / next line)
  :up            : re-enter the previous input line (works when piped, too)
  :clear / clear : clear the screen and re-prompt
  Ctrl-C         : cancel the current input line
  Ctrl-D (EOF)   : exit the REPL`;

// Assert that x is a number, throwing an EvalException otherwise. Used to
// guard the arithmetic/comparison built-ins against non-numeric arguments.
function ensureNum(x: unknown): Numeric {
	if (isNumeric(x)) return x;
	throw new EvalException("not a number", x);
}

export function registerBuiltins(interp: Interp): void {
	registerListOps(interp);
	registerPredicates(interp);
	registerArith(interp);
	registerIO(interp);
	registerSymbols(interp);
	registerMisc(interp);
}

function registerListOps(interp: Interp): void {
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
}

function registerPredicates(interp: Interp): void {
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
			return x === y
				? true
				: isNumeric(x) && isNumeric(y) && compare(x, y) === 0
					? true
					: null;
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
}

function registerArith(interp: Interp): void {
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
				throw new EvalException("one or two arguments expected", rest, false);
			}
		},
	);
}

function registerIO(interp: Interp): void {
	interp.def(
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
	interp.def(
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
	interp.def(
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
	interp.def(
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
}

function registerSymbols(interp: Interp): void {
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
			return new Sym(`G${i}`); // an uninterned symbol
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
}

function registerMisc(interp: Interp): void {
	interp.def(
		"apply",
		2,
		"(apply f args)",
		"Call `f` with the elements of the list `args` as its arguments.",
		z.tuple([zAny, zList]),
		([f, args]) => interp.eval(new Cell(f, mapList(args, qqQuote)), null),
	);
	interp.def(
		"exit",
		1,
		"(exit code)",
		"Exit the process with the given status code.",
		z.tuple([zNumeric]),
		([code]) => exit(Number(code)),
	);
	interp.def(
		"dump",
		0,
		"(dump)",
		"Return a list of all global symbols.",
		z.tuple([]),
		() => {
			let s: List = null;
			for (const x of interp.globalSyms()) s = new Cell(x, s);
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

	// Register documentation for a Lisp-defined binding. Called by the
	// defun/defmacro expansions in the prelude, so a definition and its
	// docs always travel together. The second argument is either the
	// argument list of the definition (the signature is derived from it)
	// or a ready-made signature string (used for aliases).
	interp.def(
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
						: formatSignature(sym.name, argsOrSig);
				interp.setDoc(sym.name, { signature: sig, doc: docstring });
			}
			return sym;
		},
	);
}
