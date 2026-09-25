import type { Arity } from "./docs.ts";
import type { Eval, Evaluator } from "./drive.ts";
import { cdrCell, EvalException, LoopSignal } from "./errors.ts";
import { assert, Cell, type List, type Sym } from "./objects.ts";
import { str } from "./print.ts";

export abstract class Func {
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

export abstract class DefinedFunc extends Func {
	constructor(
		carity: number,
		public readonly body: List,
	) {
		super(carity);
	}
}

export type FuncFactory = (
	carity: number,
	body: List,
	env: List,
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

	static make(carity: number, body: List, env: List): DefinedFunc {
		assert(env === null);
		return new Macro(carity, body);
	}
}

export class Lambda extends DefinedFunc {
	toString(): string {
		return `#<lambda:${this.carity}:${str(this.body)}>`;
	}

	static make(carity: number, body: List, env: List): DefinedFunc {
		assert(env === null);
		return new Lambda(carity, body);
	}
}

export class Closure extends DefinedFunc {
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

export type BuiltInFuncBody = (frame: unknown[]) => unknown;
export type BuiltInFuncGen = (frame: unknown[]) => Eval;

export type BuiltInKind = "plain" | "generator" | "promise";

export class BuiltInFunc extends Func {
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
