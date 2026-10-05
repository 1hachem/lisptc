import { Cell, type List, type Sym } from "./objects.ts";
import { str } from "./print.ts";

export class EvalException extends Error {
	readonly trace: string[] = [];
	readonly value: unknown;
	private site: string | undefined;

	constructor(msg: string, x: unknown, quoteString = true) {
		super(`${msg}: ${str(x, quoteString)}`);
		this.value = x;
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
}

export class VoidVariable extends EvalException {
	readonly variable: string;

	constructor(sym: Sym) {
		super("void variable", sym);
		this.variable = sym.name;
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
}

export class LoopSignal {
	constructor(readonly value: unknown) {}
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
