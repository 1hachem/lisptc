import { printed } from "@repo/interpreter/journal";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { introspectionExtension } from "../src/introspection.ts";
import { introspectionHost } from "../src/introspection-host.ts";

export function evWithOutput(code: string): { value: string; output: string } {
	const interp = new Interp({
		extensions: [introspectionExtension(introspectionHost)],
	});
	runSync(interp, prelude);
	let output = "";
	interp.journal.on(printed, (p) => {
		if (p.to.includes("user")) output += p.text;
	});
	return { value: str(runSync(interp, code)), output };
}

export const ev = (code: string): string => evWithOutput(code).value;
