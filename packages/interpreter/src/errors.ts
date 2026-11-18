import {
	arrayToList,
	Cell,
	LispKeyword,
	type List,
	newLispKeyword,
	type Sym,
} from "./objects.ts";
import { str } from "./print.ts";

export class EvalException extends Error {
	readonly trace: string[] = [];
	readonly value: unknown;
	private site: string | undefined;

	constructor(msg: string, x: unknown, quoteString = true) {
		super(`${msg}: ${str(x, quoteString)}`);
		this.value = x;
	}

	get kind(): string {
		return "error";
	}

	get callee(): string | undefined {
		return this.site;
	}

	calledAs(name: string): void {
		this.site ??= name;
	}

	reportedAs(msg: string): string {
		let s = `EvalException: ${msg}`;
		for (const line of this.trace) s += `\n\t${line}`;
		return s;
	}

	toString(): string {
		return this.reportedAs(this.message);
	}
}

export type HeadFailure = "undefined" | "not-applicable";

export class UnresolvedHead extends EvalException {
	constructor(
		readonly why: HeadFailure,
		readonly form: Cell,
		head: unknown,
	) {
		super(why === "undefined" ? "undefined" : "not applicable", head);
	}

	override get kind(): string {
		return this.why === "undefined" ? "undefined-function" : "not-applicable";
	}
}

export class VoidVariable extends EvalException {
	readonly variable: string;

	constructor(sym: Sym) {
		super("void variable", sym);
		this.variable = sym.name;
	}

	override get kind(): string {
		return "void-variable";
	}
}

export class ArgumentException extends EvalException {
	constructor(
		msg: string,
		x: unknown,
		readonly at: number | undefined,
	) {
		super(msg, x);
	}

	override get kind(): string {
		return "type-error";
	}
}

export class TimedOut extends EvalException {
	override get kind(): string {
		return "timeout";
	}
}

export class RaisedError extends EvalException {
	constructor(
		private readonly raisedKind: string,
		text: string,
		value: unknown,
	) {
		super(text, value);
		this.message = text;
	}

	override get kind(): string {
		return this.raisedKind;
	}
}

const kindKey = newLispKeyword("kind");
const messageKey = newLispKeyword("message");
const valueKey = newLispKeyword("value");
const raised = new WeakMap<Cell, EvalException>();

export function errorValue(ex: EvalException): Cell {
	const value = Array.isArray(ex.value) ? arrayToList(ex.value) : ex.value;
	const plist = arrayToList([
		kindKey,
		newLispKeyword(ex.kind),
		messageKey,
		ex.callee === undefined || ex instanceof RaisedError
			? ex.message
			: `${ex.callee}: ${ex.message}`,
		valueKey,
		value,
	]) as Cell;
	raised.set(plist, ex);
	return plist;
}

export function reraised(x: unknown): EvalException | undefined {
	if (!(x instanceof Cell) || x.car !== kindKey) return undefined;
	const original = raised.get(x);
	if (original !== undefined) return original;
	const fields = new Map<LispKeyword, unknown>();
	for (
		let j: unknown = x;
		j instanceof Cell && j.cdr instanceof Cell;
		j = j.cdr.cdr
	)
		if (j.car instanceof LispKeyword) fields.set(j.car, j.cdr.car);
	const kind = fields.get(kindKey);
	const message = fields.get(messageKey);
	if (!(kind instanceof LispKeyword) || typeof message !== "string")
		return undefined;
	return new RaisedError(kind.name, message, fields.get(valueKey) ?? null);
}

export class LoopSignal {
	constructor(readonly value: unknown) {}
}

export class ThrowSignal {
	constructor(
		readonly kind: unknown,
		readonly tag: unknown,
		readonly value: unknown,
	) {}
}

export class StepHold {
	constructor(readonly reason: string) {}
}

export class NotVariableException extends EvalException {
	constructor(x: unknown) {
		super("variable expected", x);
	}
}

export function cdrCell(x: Cell): List {
	const k = x.cdr;
	if (k instanceof Cell) return k;
	else if (k === null) return null;
	else throw new EvalException("proper list expected", x);
}

export function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (error instanceof StepHold) return error.reason;
	return String(error);
}
