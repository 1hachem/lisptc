/*
 * The function/closure model: built-ins, lambdas, closures, macros and the
 * compiled-argument representation.
 */
import { EvalException } from "./exceptions.ts";
import type { Interp } from "./interp.ts";
import { str } from "./printer.ts";
import { assert, Cell, cdrCell, type List, type Sym } from "./sexpr.ts";

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
export abstract class DefinedFunc extends Func {
	// body is a Lisp list as the function body.
	constructor(
		carity: number,
		public readonly body: List,
	) {
		super(carity);
	}
}

// Common function type which represents any factory methods of DefinedFunc
export type FuncFactory = (
	carity: number,
	body: List,
	env: List,
) => DefinedFunc;

// Compiled macro expression
export class Macro extends DefinedFunc {
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
export class Lambda extends DefinedFunc {
	toString(): string {
		return `#<lambda:${this.carity}:${str(this.body)}>`;
	}

	static make(carity: number, body: List, env: List): DefinedFunc {
		assert(env === null);
		return new Lambda(carity, body);
	}
}

// Compiled lambda expression (Closure with environment)
export class Closure extends DefinedFunc {
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
export type BuiltInFuncBody = (frame: unknown[]) => unknown;

// Built-in function
export class BuiltInFunc extends Func {
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
export class Arg {
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
