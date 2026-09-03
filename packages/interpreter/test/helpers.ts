import { compressionExtension } from "../src/compression.ts";
import { Interp, prelude, run, setWriter, str } from "../src/lisp.ts";
import { secretsExtension } from "../src/secrets.ts";

/**
 * A fresh interpreter with the standard prelude, secret registry and the
 * read-more built-ins (view/head/tail/grep) loaded.
 */
export function freshInterp(): Interp {
	const interp = new Interp({
		extensions: [secretsExtension(), compressionExtension()],
	});
	run(interp, prelude);
	return interp;
}

/**
 * Evaluate a whole program (one or more top-level forms) and return the
 * printed representation (via `str`) of the value of the last form.
 */
export function ev(code: string, interp: Interp = freshInterp()): string {
	return str(run(interp, code));
}

/**
 * Evaluate a program while capturing everything written by prin1/princ/
 * terpri/print. Returns both the printed value and the captured output.
 */
export function evWithOutput(code: string): { value: string; output: string } {
	const interp = freshInterp();
	let output = "";
	const prev = setWriter((s) => {
		output += s;
	});
	try {
		const value = str(run(interp, code));
		return { value, output };
	} finally {
		setWriter(prev);
	}
}
