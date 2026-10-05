import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { output } from "@repo/interpreter/topics";
import { introspectionExtension } from "../src/introspection.ts";
import { introspectionHost } from "../src/introspection-host.ts";

export function evWithOutput(code: string): { value: string; output: string } {
	const interp = new Interp({
		extensions: [introspectionExtension(introspectionHost)],
	});
	runSync(interp, prelude);
	let printed = "";
	output.on(interp.channels, (text, e) => {
		if (e.to.includes("user")) printed += text;
	});
	return { value: str(runSync(interp, code)), output: printed };
}

export const ev = (code: string): string => evWithOutput(code).value;
