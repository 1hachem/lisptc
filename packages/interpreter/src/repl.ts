/*
 * Program-level entry points: evaluating whole programs, syntax checking,
 * and the embeddable ReplSession.
 */
import { EndOfFile, EvalException } from "./exceptions.ts";
import { Interp } from "./interp.ts";
import { setWriter } from "./io.ts";
import { prelude } from "./prelude.ts";
import { str } from "./printer.ts";
import { Reader } from "./reader.ts";

// A fresh interpreter with the standard prelude loaded.
export function createInterp(): Interp {
	const interp = new Interp();
	run(interp, prelude);
	return interp;
}

// Evaluate a string as a list of Lisp exps; return the result of the last exp.
export function run(interp: Interp, text: string): unknown {
	const tokens = new Reader();
	tokens.push(text);
	let result: unknown;
	while (!tokens.isEmpty()) {
		const exp = tokens.read();
		result = interp.eval(exp, null);
	}
	return result;
}

// A syntax error found by checkSyntax, with the 1-based line it was found at.
export interface SyntaxError_ {
	message: string;
	line: number;
}

// Parse (but do not evaluate) a whole program, returning any syntax errors.
// Stops at the first error since the token stream is unreliable past it.
export function checkSyntax(text: string): SyntaxError_[] {
	const tokens = new Reader();
	tokens.push(text);
	while (!tokens.isEmpty()) {
		try {
			tokens.read();
		} catch (ex) {
			if (ex === EndOfFile)
				return [
					{
						message: "unexpected end of input (unbalanced parentheses?)",
						line: tokens.line,
					},
				];
			if (ex instanceof EvalException)
				return [{ message: String(ex.message), line: tokens.line }];
			throw ex;
		}
	}
	return [];
}

// A persistent in-process REPL: `eval` runs a program and returns what the
// interactive REPL would have printed (last value + side-effect output, errors
// rendered inline). Lets embedders run Lisp without spawning a subprocess.
export class ReplSession {
	private interp: Interp;

	constructor() {
		this.interp = createInterp();
	}

	// Evaluate a program; state persists across calls. Lisp errors are rendered
	// into the returned output rather than thrown.
	eval(code: string): string {
		let out = "";
		const prev = setWriter((s) => {
			out += s;
		});
		try {
			// Bind value before appending: `out += str(run(...))` reads `out`
			// before run() writes side-effect output into it, clobbering it.
			const value = str(run(this.interp, code));
			out += `${value}\n`;
		} catch (ex) {
			if (ex instanceof EvalException) out += `${ex}\n`;
			else if (ex === EndOfFile)
				out += "unbalanced expression (unexpected end of input)\n";
			else throw ex;
		} finally {
			setWriter(prev);
		}
		return out;
	}

	// Discard all definitions; start from a fresh prelude-loaded interp.
	reset(): void {
		this.interp = createInterp();
	}
}
