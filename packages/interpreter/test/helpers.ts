import { compactionExtension } from "../src/compaction.ts";
import { Interp, prelude, run, setWriter, str } from "../src/lisp.ts";
import { secretsExtension } from "../src/secrets.ts";

export function freshInterp(): Interp {
	const interp = new Interp({
		extensions: [secretsExtension(), compactionExtension()],
	});
	run(interp, prelude);
	return interp;
}

export function ev(code: string, interp: Interp = freshInterp()): string {
	return str(run(interp, code));
}

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
