import { z } from "zod";
import { type Image, restore, snapshot } from "../src/image.ts";
import { bufferSink } from "../src/journal.ts";
import { Interp, type InterpOptions, runAsync, runSync } from "../src/lisp.ts";
import { prelude } from "../src/prelude.ts";
import { str } from "../src/print.ts";
import { LispPromise } from "../src/promise.ts";
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
	const buffer = bufferSink();
	const detach = interp.journal.pipe(buffer);
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

export function withSettle(interp: Interp): Interp {
	interp.def(
		"settle",
		1,
		"(settle p)",
		"Wait for `p` and return what it settled to.",
		z.tuple([z.instanceof(LispPromise)]),
		([p]) => p.promise(),
	);
	return interp;
}

export async function evAsync(code: string, interp: Interp): Promise<string> {
	return str((await runAsync(interp, code)).value);
}
