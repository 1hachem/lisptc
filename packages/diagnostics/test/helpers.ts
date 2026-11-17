import { bufferSink, hitch } from "@repo/interpreter/journal";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
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
	const buffer = bufferSink();
	const detach = interp.journal.pipe(buffer);
	try {
		runSync(interp, code);
	} catch {
	} finally {
		detach();
	}
	return buffer
		.collect(hitch)
		.filter((n) => n.kind === "failed")
		.map((n) => n.text)
		.join("");
}
