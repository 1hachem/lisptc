import { Cell, type List } from "./objects.ts";
import { str } from "./print.ts";

export class EvalException extends Error {
	readonly trace: string[] = [];
	readonly value: unknown;

	constructor(msg: string, x: unknown, quoteString = true) {
		super(`${msg}: ${str(x, quoteString)}`);
		this.value = x;
	}

	toString(): string {
		let s = `EvalException: ${this.message}`;
		for (const line of this.trace) s += `\n\t${line}`;
		return s;
	}
}

export class UnresolvedHead extends EvalException {
	constructor(
		msg: string,
		readonly form: Cell,
		head: unknown,
	) {
		super(msg, head);
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
