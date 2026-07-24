/*
 * The interpreter's exception types and the end-of-file sentinel.
 */
import { str } from "./printer.ts";

// Exception in evaluation
export class EvalException extends Error {
	readonly trace: string[] = [];

	constructor(msg: string, x: unknown, quoteString = true) {
		super(`${msg}: ${str(x, quoteString)}`);
	}

	toString(): string {
		let s = `EvalException: ${this.message}`;
		for (const line of this.trace) s += `\n\t${line}`;
		return s;
	}
}

// Exception which indicates an absence of a variable
export class NotVariableException extends EvalException {
	constructor(x: unknown) {
		super("variable expected", x);
	}
}

// Exception thrown when something does not have an expected format
export class FormatException extends Error {}

// Singleton for end-of-file
export const EndOfFile = { toString: () => "EOF" };
