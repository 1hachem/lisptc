import { Cell, type List } from "./objects.ts";
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

	toString(): string {
		let s = `EvalException: ${this.message}`;
		for (const line of this.trace) s += `\n\t${line}`;
		return s;
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
