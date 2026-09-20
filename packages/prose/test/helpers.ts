import { bufferTransport } from "@repo/interpreter/channels-host";
import { Interp, prelude, runSync, str } from "@repo/interpreter/lisp";
import { proseExtension } from "../src/prose.ts";

export function proseInterp(): Interp {
	const interp = new Interp({ extensions: [proseExtension()] });
	runSync(interp, prelude);
	return interp;
}

export function freshInterp(): Interp {
	const interp = new Interp();
	runSync(interp, prelude);
	return interp;
}

export function ev(code: string, interp: Interp = proseInterp()): string {
	return str(runSync(interp, code));
}

export function evProse(code: string, interp: Interp = proseInterp()): string {
	return ev(code, interp);
}

export function evWithOutput(
	code: string,
	interp: Interp = proseInterp(),
): { value: string; output: string } {
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	try {
		return { value: str(runSync(interp, code)), output: buffer.text("user") };
	} finally {
		detach();
	}
}
