import { bufferTransport } from "@repo/interpreter/channels-host";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { introspectionExtension } from "../src/introspection.ts";
import { introspectionHost } from "../src/introspection-host.ts";

function freshInterp(): Interp {
	const interp = new Interp({
		extensions: [introspectionExtension(introspectionHost)],
	});
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
