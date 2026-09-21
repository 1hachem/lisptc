import { bufferTransport } from "../src/channels-host.ts";
import { Interp, prelude, runSync, str } from "../src/lisp.ts";

export function freshInterp(): Interp {
	const interp = new Interp();
	runSync(interp, prelude);
	return interp;
}

export function ev(code: string, interp: Interp = freshInterp()): string {
	return str(runSync(interp, code));
}

export function evWithOutput(
	code: string,
	interp: Interp = freshInterp(),
): { value: string; output: string } {
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	try {
		return {
			value: str(runSync(interp, code)),
			output: buffer.collectText("user"),
		};
	} finally {
		detach();
	}
}
