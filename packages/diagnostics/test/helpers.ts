import { bufferTransport } from "@repo/interpreter/channels-host";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { note } from "@repo/interpreter/topics";
import { diagnosticsExtension } from "../src/diagnostics.ts";
import { diagnosticsHost } from "../src/diagnostics-host.ts";

export function freshInterp(): Interp {
	const interp = new Interp({
		extensions: [diagnosticsExtension(diagnosticsHost)],
	});
	runSync(interp, prelude);
	return interp;
}

export function reportOf(code: string, interp: Interp = freshInterp()): string {
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	try {
		runSync(interp, code);
	} catch {
	} finally {
		detach();
	}
	return buffer
		.collect(note)
		.filter((n) => n.kind === "failed")
		.map((n) => n.text)
		.join("");
}
