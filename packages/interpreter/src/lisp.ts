import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import type { Awaitable } from "@repo/shared/host";
import type { z } from "zod";
import { AsyncWork } from "./async.ts";
import { Channels } from "./channels.ts";
import { compileFunc } from "./compile.ts";
import { installCore } from "./core-builtins.ts";
import {
	type Arity,
	type Doc,
	type DocArgSpec,
	type DocValue,
	specialFormDocs,
} from "./docs.ts";
import {
	driveAsync,
	driveSync,
	type Eval,
	Hold,
	Holds,
	type Outcome,
	settled,
} from "./drive.ts";
import {
	cdrCell,
	EvalException,
	LoopSignal,
	NotVariableException,
	StepHold,
	UnresolvedHead,
	VoidVariable,
} from "./errors.ts";
import {
	Arg,
	BuiltInFunc,
	type BuiltInFuncBody,
	type BuiltInFuncGen,
	Closure,
	callableArity,
	type DefinedFunc,
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
import { Recovery } from "./recovery.ts";
import { parseArgs } from "./schema.ts";
import { LANGUAGE_REFERENCE } from "./source.ts";
import { note } from "./topics.ts";
import type { ForeignValue } from "./types.ts";

export type FailedForm =
	| { readonly skipped: string }
	| { readonly reported: string };

export interface Hooks {
	readonly readSource: Chain<[interp: Interp, text: string], string>;
	readonly evalForm: Chain<[interp: Interp, form: unknown], Eval>;
	readonly failedForm: Chain<
		[interp: Interp, form: unknown, error: EvalException],
		Eval<FailedForm | undefined>
	>;
	readonly call: Chain<
		[interp: Interp, name: string, args: readonly unknown[]],
		Awaitable<void>
	>;
	readonly dispose: Chain<[], void>;
}

export function newHooks(): Hooks {
	return {
		readSource: new Chain(),
		evalForm: new Chain(),
		failedForm: new Chain(),
		call: new Chain(),
		dispose: new Chain(),
	};
}

export interface StateCodec<T> {
	toLisp(value: T): unknown;
	fromLisp(x: unknown): T;
}

export interface State<T> {
	get(): T;
	set(value: T): void;
}

export function detachedState<T>(initial: T): State<T> {
	let value = initial;
	return {
		get: () => value,
		set: (next) => {
			value = next;
		},
	};
}

export interface Contents {
	readonly globals: readonly (readonly [Sym, unknown, string | undefined])[];
	readonly docs: readonly (readonly [string, Doc])[];
	readonly sources: readonly (readonly [string, unknown])[];
}

export interface Installable {
	(interp: Interp): void;
	readonly prompt?: string;
}

export interface InterpOptions {
	extensions?: readonly Installable[];
}

class Tail {
	constructor(
		readonly x: unknown,
		readonly env: List,
	) {}
}

function applicable(x: Cell, fn: unknown): Closure | BuiltInFunc {
	if (fn instanceof Closure || fn instanceof BuiltInFunc) return fn;
	throw new UnresolvedHead("not-applicable", x, fn);
}

function copyRest(fn: Closure | BuiltInFunc, frame: unknown[]): List {
	const fixed = fn.fixedArgs;
	const rest = frame[fixed];
	if (!fn.hasRest || !(rest instanceof Cell)) return null;
	let head: List = null;
	let tail: Cell | null = null;
	for (let j: List = rest; j !== null; j = cdrCell(j)) {
		const cell = new Cell(j.car, null);
		if (tail === null) head = cell;
		else tail.cdr = cell;
		tail = cell;
	}
	frame[fixed] = head;
	return head;
}

function copyTree(x: unknown): unknown {
	return x instanceof Cell ? new Cell(copyTree(x.car), copyTree(x.cdr)) : x;
}

export class Interp {
	private readonly globals: Map<Sym, unknown> = new Map();

	private readonly sealed: Map<Sym, string> = new Map();

	readonly hooks: Hooks = newHooks();

	readonly recovery: Recovery = new Recovery();

	readonly channels: Channels = new Channels();

	readonly async: AsyncWork = new AsyncWork();

	readonly holds: Holds = new Holds();

	readonly importStack: string[] = [];
	private readonly importing: Set<string> = new Set();

	private readonly docTable: Map<string, Doc> = new Map();

	private readonly liveValues: Map<string, Map<string, () => DocValue[]>> =
		new Map();

	private readonly sources: Map<string, unknown> = new Map();

	private readonly prompts: string[] = [];

	globalNames(): string[] {
		return [...this.globals.keys()].map((s) => s.name);
	}

	docs(): Map<string, Doc> {
		return new Map([
			...Object.entries(specialFormDocs),
			...[...this.docTable].map(
				([name, doc]) => [name, this.withLiveValues(name, doc)] as const,
			),
		]);
	}

	private withLiveValues(name: string, doc: Doc): Doc {
		const live = this.liveValues.get(name);
		if (live === undefined || doc.args === undefined) return doc;
		return {
			...doc,
			args: doc.args.map((arg) => {
				const values = live.get(arg.name);
				return values === undefined ? arg : { ...arg, values: values() };
			}),
		};
	}

	private document(
		name: string,
		signature: string,
		doc: string,
		specs?: DocArgSpec[],
	): void {
		const live = new Map<string, () => DocValue[]>();
		const args = specs?.map(({ values, ...arg }) => {
			if (typeof values !== "function")
				return values === undefined ? arg : { ...arg, values };
			live.set(arg.name, values);
			return arg;
		});
		if (live.size > 0) this.liveValues.set(name, live);
		else this.liveValues.delete(name);
		this.docTable.set(name, { signature, doc, args });
	}

	isMacro(name: string): boolean {
		return this.globals.get(newSym(name)) instanceof Macro;
	}

	arityOf(name: string): Arity | undefined {
		return callableArity(this.globals.get(newSym(name)));
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
		args?: DocArgSpec[],
		keys?: readonly string[],
	) {
		const wrapped: BuiltInFuncBody = (a) => body(parseArgs(schema, a));
		this.globals.set(
			newSym(name),
			new BuiltInFunc(name, carity, wrapped, "plain", keys),
		);
		this.document(name, signature, doc, args);
	}

	defGen<T extends z.ZodType>(
		name: string,
		carity: number,
		signature: string,
		doc: string,
		schema: T,
		body: (a: z.infer<T>) => Eval,
		args?: DocArgSpec[],
		keys?: readonly string[],
	) {
		const wrapped: BuiltInFuncGen = (a) => body(parseArgs(schema, a));
		this.globals.set(
			newSym(name),
			new BuiltInFunc(name, carity, wrapped, "generator", keys),
		);
		this.document(name, signature, doc, args);
	}

	defPromise<T extends z.ZodType>(
		name: string,
		carity: number,
		signature: string,
		doc: string,
		schema: T,
		body: (a: z.infer<T>) => Promise<unknown>,
		args?: DocArgSpec[],
		keys?: readonly string[],
	) {
		const wrapped: BuiltInFuncBody = (a) => body(parseArgs(schema, a));
		this.globals.set(
			newSym(name),
			new BuiltInFunc(name, carity, wrapped, "promise", keys),
		);
		this.document(name, signature, doc, args);
	}

	defResumable<T extends z.ZodType>(
		name: string,
		carity: number,
		signature: string,
		doc: string,
		schema: T,
		body: (a: z.infer<T>) => Promise<unknown>,
		args?: DocArgSpec[],
		keys?: readonly string[],
	) {
		this.defPromise(name, carity, signature, doc, schema, body, args, keys);
		this.recovery.resumable(name, (a) => body(parseArgs(schema, [...a])));
	}

	defineGlobal(sym: Sym, value: unknown, doc?: Doc): void {
		this.globals.set(sym, value);
		this.sources.delete(sym.name);
		if (doc !== undefined) this.docTable.set(sym.name, doc);
	}

	undefineGlobal(sym: Sym): void {
		this.globals.delete(sym);
		this.sealed.delete(sym);
		this.docTable.delete(sym.name);
		this.liveValues.delete(sym.name);
		this.sources.delete(sym.name);
	}

	seal(sym: Sym, owner: string): void {
		this.sealed.set(sym, owner);
	}

	ownerOf(sym: Sym): string | undefined {
		return this.sealed.get(sym);
	}

	state<T>(
		name: string,
		codec: StateCodec<T>,
		initial: T,
		doc: string,
	): State<T> {
		const sym = newSym(`*${name}*`);
		if (this.globals.has(sym))
			throw new EvalException("state declared twice", sym);
		this.defineGlobal(sym, codec.toLisp(initial), { signature: sym.name, doc });
		this.seal(sym, name.split("/")[0]);
		return {
			get: () => codec.fromLisp(this.globals.get(sym)),
			set: (value) => {
				this.globals.set(sym, codec.toLisp(value));
			},
		};
	}

	contents(): Contents {
		return {
			globals: [...this.globals].map(
				([sym, value]) => [sym, value, this.sealed.get(sym)] as const,
			),
			docs: [...this.docTable],
			sources: [...this.sources],
		};
	}

	load(contents: Contents): void {
		for (const [sym, value, owner] of contents.globals) {
			this.globals.set(sym, value);
			if (owner === undefined) this.sealed.delete(sym);
			else this.sealed.set(sym, owner);
		}
		for (const [name, doc] of contents.docs) this.docTable.set(name, doc);
		this.sources.clear();
		for (const [name, form] of contents.sources) this.sources.set(name, form);
	}

	setDoc(name: string, doc: Doc): void {
		this.refuseSealed(newSym(name));
		this.docTable.set(name, doc);
	}

	setSource(name: string, form: unknown): void {
		this.refuseSealed(newSym(name));
		this.sources.set(name, copyTree(form));
	}

	private refuseSealed(sym: Sym): void {
		const owner = this.sealed.get(sym);
		if (owner !== undefined)
			throw new EvalException(`read-only global owned by ${owner}`, sym, false);
	}

	sourceOf(name: string): unknown {
		return copyTree(this.sources.get(name));
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

	private *guardCall(name: string, args: readonly unknown[]): Eval<void> {
		yield* settled(this.hooks.call.run(() => undefined, this, name, args));
	}

	hold(reason: string): Hold | undefined {
		if (!this.holds.parkable) return undefined;
		note.emit(this.channels, { model: { kind: "held", text: reason } });
		return this.holds.park(new Hold(reason));
	}

	makeBuiltIn(
		name: string,
		carity: number,
		body: BuiltInFuncBody,
		foreign?: ForeignValue,
	): unknown {
		return new BuiltInFunc(
			name,
			carity,
			body,
			"plain",
			[],
			foreign === undefined ? { by: "none" } : { by: "foreign", foreign },
		);
	}

	evalNow(x: unknown, env: List): unknown {
		if (x instanceof Arg) {
			assert(env !== null);
			return x.getValue(env);
		}
		if (x instanceof Sym) {
			const value = this.globals.get(x);
			if (value === undefined) throw new VoidVariable(x);
			return this.sealed.has(x) ? copyTree(value) : value;
		}
		if (x instanceof Lambda) return Closure.makeFrom(x, env);
		return x;
	}

	*evalGen(x: unknown, env: List): Eval {
		try {
			for (;;) {
				if (!(x instanceof Cell)) return this.evalNow(x, env);
				const next =
					x.car instanceof Keyword
						? yield* this.evalSpecial(x.car, x, env)
						: yield* this.evalApplication(x, env);
				if (!(next instanceof Tail)) return next;
				x = next.x;
				env = next.env;
			}
		} catch (ex) {
			if (ex instanceof EvalException) {
				if (ex.trace.length < 10) ex.trace.push(str(x));
				if (x instanceof Cell && x.car instanceof Sym) ex.calledAs(x.car.name);
			}
			throw ex;
		}
	}

	private *evalSpecial(fn: Keyword, x: Cell, env: List): Eval {
		const arg = cdrCell(x);
		if (!this.hooks.call.isEmpty) yield* this.guardCall(fn.name, []);
		switch (fn) {
			case quoteSym:
				if (arg !== null && arg.cdr === null) return arg.car;
				throw new EvalException("bad quote", x);
			case prognSym:
				return new Tail(
					arg !== null && arg.cdr === null
						? arg.car
						: yield* this.evalProgN(arg, env),
					env,
				);
			case condSym:
				return new Tail(yield* this.evalCond(arg, env), env);
			case setqSym:
				return yield* this.evalSetQ(arg, env);
			case trySym: {
				const [nx, nenv] = yield* this.evalTry(arg, env);
				return new Tail(nx, nenv);
			}
			case lambdaSym:
				return this.compile(arg, env, Closure.make);
			case macroSym:
				if (env !== null) throw new EvalException("nested macro", x);
				return this.compile(arg, null, Macro.make);
			case quasiquoteSym:
				if (arg !== null && arg.cdr === null)
					return new Tail(qqExpand(arg.car), env);
				throw new EvalException("bad quasiquote", x);
			default:
				throw new EvalException("bad keyword", fn);
		}
	}

	private *evalApplication(x: Cell, env: List): Eval {
		const arg = cdrCell(x);
		const fn =
			x.car instanceof Cell
				? yield* this.evalGen(x.car, env)
				: this.head(x, env);
		if (fn instanceof Macro) {
			yield* this.guardMacro(x);
			return new Tail(yield* fn.expandWith(this, arg), env);
		}
		const applied = applicable(x, fn);
		const frame = applied.makeFrame(arg);
		for (let i = 0; i < applied.fixedArgs; i++) {
			const a = frame[i];
			frame[i] =
				a instanceof Cell ? yield* this.evalGen(a, env) : this.evalNow(a, env);
		}
		for (let j = copyRest(applied, frame); j !== null; j = j.cdr as List) {
			const a = j.car;
			j.car =
				a instanceof Cell ? yield* this.evalGen(a, env) : this.evalNow(a, env);
		}
		if (applied instanceof BuiltInFunc)
			return yield* this.callBuiltIn(applied, frame);
		const inner = new Cell(frame, applied.env);
		const { body } = applied;
		return new Tail(
			body !== null && body.cdr === null
				? body.car
				: yield* this.evalProgN(body, inner),
			inner,
		);
	}

	private head(x: Cell, env: List): unknown {
		const head = x.car;
		if (!(head instanceof Sym)) return this.evalNow(head, env);
		const fn = this.globals.get(head);
		if (fn === undefined) throw new UnresolvedHead("undefined", x, head);
		return fn;
	}

	private *guardMacro(x: Cell): Eval<void> {
		if (!this.hooks.call.isEmpty && x.car instanceof Sym)
			yield* this.guardCall(x.car.name, []);
	}

	private *callBuiltIn(fn: BuiltInFunc, frame: unknown[]): Eval {
		if (!this.hooks.call.isEmpty)
			yield* this.guardCall(fn.callName as string, frame);
		if (fn.kind === "generator") return yield* fn.callGen(frame);
		const value = fn.call(frame);
		if (!(value instanceof Promise)) return value;
		if (fn.kind === "plain") return yield* fn.settle(value);
		const name = fn.callName as string;
		return this.async.watch(
			value,
			this.recovery.resumer(name) === undefined
				? undefined
				: { kind: name, args: [...frame] },
		);
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
			assert(handler instanceof Closure);
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
				this.refuseSealed(lval);
				this.globals.set(lval, result);
				this.sources.delete(lval.name);
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
		if (ex instanceof StepHold) {
			note.emit(interp.channels, { model: { kind: "held", text: ex.reason } });
			throw ex;
		}
		const failure =
			ex instanceof LoopSignal
				? new EvalException("break/return used outside of a loop", null, false)
				: ex;
		if (failure instanceof EvalException) {
			const opinion = yield* interp.hooks.failedForm.run(
				() => settled(undefined),
				interp,
				exp,
				failure,
			);
			if (opinion !== undefined && "skipped" in opinion) {
				note.emit(interp.channels, {
					model: { kind: "skipped", text: opinion.skipped },
				});
				return previous;
			}
			note.emit(interp.channels, {
				model: {
					kind: "failed",
					text: opinion === undefined ? String(failure) : opinion.reported,
				},
			});
		}
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
