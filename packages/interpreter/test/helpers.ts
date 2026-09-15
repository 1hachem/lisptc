import { bufferTransport } from "../src/channels-host.ts";
import { compactionExtension } from "../src/extensions/compaction/compaction.ts";
import { secretsExtension } from "../src/extensions/secrets/secrets.ts";
import { Interp, prelude, runAsync, runSync, str } from "../src/lisp.ts";

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
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	try {
		return { value: str(runSync(interp, code)), output: buffer.text("user") };
	} finally {
		detach();
	}
}
