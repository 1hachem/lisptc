import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { type Admission, openSession } from "@repo/interpreter/session";
import { lintExtension } from "../src/lint.ts";

export function linted(): Interp {
	const interp = new Interp({ extensions: [lintExtension()] });
	runSync(interp, prelude);
	return interp;
}

export function admit(code: string, interp = linted()): Promise<Admission> {
	return openSession([lintExtension()]).admit.run(
		async (_i, c) => ({ code: c }),
		interp,
		code,
	);
}
