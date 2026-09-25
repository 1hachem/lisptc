import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import type { z } from "zod";
import { AsyncWork } from "./async.ts";
import { Channels } from "./channels.ts";
import { compileFunc } from "./compile.ts";
import { installCore } from "./core-builtins.ts";
import { type Arity, type Doc, type DocArg, specialFormDocs } from "./docs.ts";
import {
	driveAsync,
	driveSync,
	type Eval,
	type Outcome,
	settled,
} from "./drive.ts";
import {
	cdrCell,
	EvalException,
	LoopSignal,
	NotVariableException,
	UnresolvedHead,
} from "./errors.ts";
import {
	Arg,
	BuiltInFunc,
	type BuiltInFuncBody,
	type BuiltInFuncGen,
	Closure,
	type DefinedFunc,
	Func,
	type FuncFactory,
	Lambda,
	Macro,
} from "./func.ts";
import { Chain } from "./hooks.ts";
import {
	assert,
	Cell,
	catchSym,
	condSym,
	Keyword,
	type List,
	lambdaSym,
	macroSym,
	mapcar,
	newSym,
	prognSym,
	quasiquoteSym,
	quoteSym,
	Sym,
	setqSym,
	trySym,
	Unspecified,
} from "./objects.ts";
import { str } from "./print.ts";
import { qqExpand, qqQuote } from "./quasiquote.ts";
import { Reader } from "./reader.ts";
import { parseArgs } from "./schema.ts";
import { LANGUAGE_REFERENCE } from "./source.ts";
import { note } from "./topics.ts";

export interface Hooks {
	readonly readSource: Chain<[interp: Interp, text: string], string>;
	readonly evalForm: Chain<[interp: Interp, form: unknown], Eval>;
	readonly failedForm: Chain<
		[interp: Interp, form: unknown, error: UnresolvedHead],
		Eval<string | undefined>
	>;
	readonly dispose: Chain<[], void>;
}

export function newHooks(): Hooks {
	return {
		readSource: new Chain(),
		evalForm: new Chain(),
		failedForm: new Chain(),
		dispose: new Chain(),
	};
}

export interface Installable {
	(interp: Interp): void;
	readonly prompt?: string;
}

export interface InterpOptions {
	extensions?: readonly Installable[];
}

export class Interp {
	private readonly globals: Map<Sym, unknown> = new Map();

	readonly hooks: Hooks = newHooks();

	readonly channels: Channels = new Channels();

	readonly async: AsyncWork = new AsyncWork();

	readonly importStack: string[] = [];
	private readonly importing: Set<string> = new Set();

	private readonly docTable: Map<string, Doc> = new Map();

	private readonly prompts: string[] = [];

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
		installCore(this, {
			apply: (a) => this.applyForm(a),
			runLoopBody: (a) => this.runLoopBody(a),
			importFile: (path) => this.importFile(path),
		});

		for (const extension of options.extensions ?? []) {
			extension(this);
			if (extension.prompt) this.prompts.push(extension.prompt);
		}
	}

	systemPrompt(): string {
		return [LANGUAGE_REFERENCE, ...this.prompts].join("\n\n");
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

	setDoc(name: string, doc: Doc): void {
		this.docTable.set(name, doc);
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

	dispose(): void {
		this.hooks.dispose.run(() => this.async.abortAll());
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
							if (fn === undefined)
								throw new UnresolvedHead("undefined", x, x.car);
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
								if (value instanceof Promise)
									return fn.kind === "plain"
										? yield* fn.settle(value)
										: this.async.watch(value);
								return value;
							}
							env = new Cell(frame, fn.env);
							const { body } = fn;
							x =
								body !== null && body.cdr === null
									? body.car
									: yield* this.evalProgN(body, env);
						} else {
							throw new UnresolvedHead("not applicable", x, fn);
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
		return compileFunc(this, arg, env, make);
	}
}

export function* evalTopLevel(
	interp: Interp,
	exp: unknown,
	previous: unknown = Unspecified,
): Eval {
	try {
		return yield* interp.evalGen(exp, null);
	} catch (ex) {
		const failure =
			ex instanceof LoopSignal
				? new EvalException("break/return used outside of a loop", null, false)
				: ex;
		if (failure instanceof UnresolvedHead && failure.form === exp) {
			const excused = yield* interp.hooks.failedForm.run(
				() => settled(undefined),
				interp,
				exp,
				failure,
			);
			if (excused !== undefined) {
				note.emit(interp.channels, {
					model: { kind: "skipped", text: excused },
				});
				return previous;
			}
		}
		if (failure instanceof EvalException)
			note.emit(interp.channels, {
				model: { kind: "failed", text: String(failure) },
			});
		throw failure;
	}
}

function sourceAsWritten(_: Interp, text: string): string {
	return text;
}

export function* runGen(interp: Interp, text: string): Eval {
	const { hooks } = interp;
	const tokens = new Reader();
	tokens.push(hooks.readSource.run(sourceAsWritten, interp, text));
	let result: unknown = Unspecified;
	while (!tokens.isEmpty()) {
		const exp = tokens.read();
		const previous = result;
		result = yield* hooks.evalForm.run(
			(i, form) => evalTopLevel(i, form, previous),
			interp,
			exp,
		);
	}
	return result;
}

export function runSync(interp: Interp, text: string): unknown {
	return driveSync(runGen(interp, text));
}

export function runAsync(interp: Interp, text: string): Promise<Outcome> {
	return driveAsync(runGen(interp, text));
}
