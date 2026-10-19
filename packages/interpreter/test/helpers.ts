import { bufferTransport } from "../src/channels-host.ts";
import { type Image, restore, snapshot } from "../src/image.ts";
import { Interp, type InterpOptions, runSync } from "../src/lisp.ts";
import { prelude } from "../src/prelude.ts";
import { str } from "../src/print.ts";
export function freshInterp(options?: InterpOptions): Interp {
	const interp = new Interp(options);
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

export function imageOf(interp: Interp): Image {
	return JSON.parse(JSON.stringify(snapshot(interp)));
}

export function roundTrip(interp: Interp, options?: InterpOptions): Interp {
	const next = new Interp(options);
	restore(next, imageOf(interp));
	return next;
}
