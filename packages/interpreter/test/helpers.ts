import { compactionExtension } from "../src/compaction.ts";
import {
	Interp,
	prelude,
	runAsync,
	runSync,
	setWriter,
	str,
} from "../src/lisp.ts";
import { secretsExtension } from "../src/secrets.ts";

export function freshInterp(): Interp {
	const interp = new Interp({
		extensions: [secretsExtension(), compactionExtension()],
	});
	runSync(interp, prelude);
	return interp;
}

export function ev(code: string, interp: Interp = freshInterp()): string {
	return str(runSync(interp, code));
}

export async function evAsync(
	code: string,
	interp: Interp = freshInterp(),
): Promise<string> {
	return str((await runAsync(interp, code)).value);
}

export function evWithOutput(code: string): { value: string; output: string } {
	const interp = freshInterp();
	let output = "";
	const prev = setWriter((s) => {
		output += s;
	});
	try {
		const value = str(runSync(interp, code));
		return { value, output };
	} finally {
		setWriter(prev);
	}
}
