import type { Arity } from "./docs.ts";
import type { Eval, Evaluator } from "./drive.ts";
import { cdrCell, EvalException, LoopSignal } from "./errors.ts";
import { assert, Cell, LispKeyword, type List, type Sym } from "./objects.ts";
import { str } from "./print.ts";

export abstract class Func {
	constructor(
		public readonly carity: number,
		readonly keys: readonly string[] = [],
		readonly callName?: string,
	) {}

	get arity(): number {
		return this.carity < 0 ? -this.carity : this.carity;
	}

	get hasRest(): boolean {
		return this.carity < 0;
	}

	get fixedArgs(): number {
		return this.carity < 0 ? -this.carity - 1 : this.carity;
	}

	get requiredArgs(): number {
		return this.fixedArgs - this.keys.length;
	}

	makeFrame(arg: List): unknown[] {
		const frame = new Array(this.arity);
		if (this.keys.length > 0) return this.keyedFrame(frame, arg);
		const supplied = arg;
		const n = this.fixedArgs;
		let i = 0;
		for (; i < n && arg !== null; i++) {
			frame[i] = arg.car;
			arg = cdrCell(arg);
		}
		if (i !== n || (arg !== null && !this.hasRest))
			throw new ArityException(
				{ min: this.fixedArgs, max: this.hasRest ? undefined : this.arity },
				countArgs(supplied),
				this,
			);
		if (this.hasRest) frame[n] = arg;
		return frame;
	}

	private keyedFrame(frame: unknown[], supplied: List): unknown[] {
		const required = this.requiredArgs;
		const total = this.fixedArgs;
		const taken = new Set<number>();
		let arg = supplied;
		let i = 0;
		while (i < total && arg !== null && !(arg.car instanceof LispKeyword)) {
			frame[i] = arg.car;
			taken.add(i);
			arg = cdrCell(arg);
			i++;
		}
		if (i < required || (arg !== null && !(arg.car instanceof LispKeyword)))
			throw new ArityException(
				{ min: required, max: total },
				countArgs(supplied),
				this,
			);
		for (let j = i; j < total; j++) frame[j] = null;
		while (arg !== null) {
			const key = arg.car;
			if (!(key instanceof LispKeyword))
				throw new KeywordException(
					"expected a keyword, not a value",
					key,
					this,
				);
			const at = this.keys.indexOf(key.name);
			if (at < 0)
				throw new KeywordException("no such keyword argument", key, this);
			const rest = cdrCell(arg);
			if (rest === null)
				throw new KeywordException("keyword given with no value", key, this);
			if (taken.has(required + at))
				throw new KeywordException("argument given twice", key, this);
			taken.add(required + at);
			frame[required + at] = rest.car;
			arg = cdrCell(rest);
		}
		return frame;
	}
}

export class ArityException extends EvalException {
	constructor(
		readonly expected: Arity,
		readonly given: number,
		func: Func,
	) {
		super("arity not matched", func);
		if (func.callName !== undefined) this.calledAs(func.callName);
	}
}

export class KeywordException extends EvalException {
	readonly key: string | undefined;
	readonly accepted: readonly string[];

	constructor(msg: string, key: unknown, func: Func) {
		super(msg, key);
		this.key = key instanceof LispKeyword ? key.name : undefined;
		this.accepted = func.keys;
		if (func.callName !== undefined) this.calledAs(func.callName);
	}
}

function countArgs(list: List): number {
	let n = 0;
	for (let j = list; j !== null; j = cdrCell(j)) n++;
	return n;
}

export abstract class DefinedFunc extends Func {
	constructor(
		carity: number,
		public readonly body: List,
		keys: readonly string[] = [],
	) {
		super(carity, keys);
	}
}

export type FuncFactory = (
	carity: number,
	body: List,
	env: List,
	keys: readonly string[],
) => DefinedFunc;

export class Macro extends DefinedFunc {
	toString(): string {
		return `#<macro:${this.carity}:${str(this.body)}>`;
	}

	*expandWith(interp: Evaluator, arg: List): Eval {
		const frame = this.makeFrame(arg);
		const env = new Cell(frame, null);
		let x: unknown = null;
		for (let j = this.body; j !== null; j = cdrCell(j))
			x = yield* interp.evalGen(j.car, env);
		return x;
	}

	static make(
		carity: number,
		body: List,
		env: List,
		keys: readonly string[] = [],
	): DefinedFunc {
		assert(env === null);
		return new Macro(carity, body, keys);
	}
}

export class Lambda extends DefinedFunc {
	toString(): string {
		return `#<lambda:${this.carity}:${str(this.body)}>`;
	}

	static make(
		carity: number,
		body: List,
		env: List,
		keys: readonly string[] = [],
	): DefinedFunc {
		assert(env === null);
		return new Lambda(carity, body, keys);
	}
}

export class Closure extends DefinedFunc {
	constructor(
		carity: number,
		body: List,
		readonly env: List,
		keys: readonly string[] = [],
	) {
		super(carity, body, keys);
	}

	static makeFrom(x: Lambda, env: List) {
		return new Closure(x.carity, x.body, env, x.keys);
	}

	toString(): string {
		return `#<closure:${this.carity}:${str(this.body)}>`;
	}

	static make(
		carity: number,
		body: List,
		env: List,
		keys: readonly string[] = [],
	): DefinedFunc {
		return new Closure(carity, body, env, keys);
	}
}

export type BuiltInFuncBody = (frame: unknown[]) => unknown;
export type BuiltInFuncGen = (frame: unknown[]) => Eval;

export type BuiltInKind = "plain" | "generator" | "promise";

export class BuiltInFunc extends Func {
	constructor(
		name: string,
		carity: number,
		private readonly body: BuiltInFuncBody | BuiltInFuncGen,
		readonly kind: BuiltInKind = "plain",
		keys: readonly string[] = [],
	) {
		super(carity, keys, name);
	}

	toString(): string {
		return `#<${this.callName}:${this.carity}>`;
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
			throw this.named(
				new EvalException(
					`${this.callName} failed`,
					ex instanceof Error ? ex.message : String(ex),
					false,
				),
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
		if (ex instanceof LoopSignal) return ex;
		if (ex instanceof EvalException) return this.named(ex);
		return this.named(new EvalException(`${ex} -- ${this.callName}`, frame));
	}

	private named(ex: EvalException): EvalException {
		if (this.callName !== undefined) ex.calledAs(this.callName);
		return ex;
	}
}

export function callableKind(x: unknown): "function" | "macro" | undefined {
	if (x instanceof Macro) return "macro";
	if (x instanceof Func) return "function";
	return undefined;
}

export function callableArity(x: unknown): Arity | undefined {
	if (!(x instanceof Func)) return undefined;
	if (x.hasRest) return { min: x.fixedArgs, max: undefined };
	return { min: x.requiredArgs, max: x.arity };
}

export class Arg {
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
