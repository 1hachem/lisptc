/*
 * The evaluator core: the Interp class (global environment + eval loop) and
 * the documentation table. Built-in functions are registered from
 * builtins.ts; MCP built-ins from mcp/index.ts.
 */
import type { z } from "zod";
import { registerBuiltins } from "./builtins.ts";
import { makeArgTable, qqExpand, qqQuote, scanForArgs } from "./compile.ts";
import { EvalException, NotVariableException } from "./exceptions.ts";
import {
	Arg,
	BuiltInFunc,
	type BuiltInFuncBody,
	Closure,
	type DefinedFunc,
	type FuncFactory,
	Lambda,
	Macro,
} from "./func.ts";
import { registerMcp } from "./mcp/index.ts";
import { str } from "./printer.ts";
import { parseArgs } from "./schemas.ts";
import {
	assert,
	Cell,
	cdrCell,
	condSym,
	Keyword,
	type List,
	lambdaSym,
	macroSym,
	mapList,
	newSym,
	prognSym,
	quasiquoteSym,
	quoteSym,
	Sym,
	setqSym,
} from "./sexpr.ts";

// Cap on nested macro expansions during compilation.
const MAX_MACRO_EXPANSIONS = 20;

// Cap on the number of stack entries recorded in an EvalException trace.
const MAX_TRACE_LINES = 10;

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

// Render a call signature string from a name and its Lisp argument list.
export function formatSignature(name: string, argList: List): string {
	const parts = [name];
	for (let c = argList; c !== null; c = c.cdr as Cell | null)
		parts.push(str(c.car));
	return `(${parts.join(" ")})`;
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
		registerBuiltins(this);
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
	// remove per-tool wrapper functions at runtime (see src/mcp/index.ts).
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

	getGlobal(sym: Sym): unknown {
		return this.globals.get(sym);
	}

	// All global symbols (for the dump built-in).
	globalSyms(): Sym[] {
		return [...this.globals.keys()];
	}

	// Register documentation for a named binding (see the _set-doc built-in).
	setDoc(name: string, doc: Doc): void {
		this.docTable.set(name, doc);
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
				if (ex.trace.length < MAX_TRACE_LINES) ex.trace.push(str(x));
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
		body = this.expandMacros(body, MAX_MACRO_EXPANSIONS) as List;
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
					return mapList(j, (x) => this.expandMacros(x, count));
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
					return mapList(j, (x) => this.compileInners(x));
			}
		} else {
			return j;
		}
	}
}
