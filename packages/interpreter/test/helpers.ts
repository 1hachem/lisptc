import { bufferTransport } from "../src/channels-host.ts";
import { compactionExtension } from "../src/extensions/compaction/compaction.ts";
import { proseExtension } from "../src/extensions/prose/prose.ts";
import { secretsExtension } from "../src/extensions/secrets/secrets.ts";
import { Interp, prelude, runAsync, runSync, str } from "../src/lisp.ts";

export function freshInterp(): Interp {
	const interp = new Interp({
		extensions: [secretsExtension(), compactionExtension()],
	});
	runSync(interp, prelude);
	return interp;
}

export function proseInterp(): Interp {
	const interp = new Interp({
		extensions: [secretsExtension(), compactionExtension(), proseExtension()],
	});
	runSync(interp, prelude);
	return interp;
}

export function ev(code: string, interp: Interp = freshInterp()): string {
	return str(runSync(interp, code));
}

export function evProse(code: string, interp: Interp = proseInterp()): string {
	return ev(code, interp);
}

export async function evAsync(
	code: string,
	interp: Interp = freshInterp(),
): Promise<string> {
	return str((await runAsync(interp, code)).value);
}

export function evWithOutput(
	code: string,
	interp: Interp = freshInterp(),
): { value: string; output: string } {
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	try {
		return { value: str(runSync(interp, code)), output: buffer.text("user") };
	} finally {
		detach();
	}
}
