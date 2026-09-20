import { Interp, prelude, runSync, str } from "@repo/interpreter/lisp";
import { MapSecretsStore, secretsExtension } from "../src/secrets.ts";
import { secretsHost } from "../src/secrets-host.ts";

export function ev(code: string, interp: Interp = freshInterp()): string {
	return str(runSync(interp, code));
}

function freshInterp(): Interp {
	const interp = new Interp({
		extensions: [
			secretsExtension({ ...secretsHost, store: new MapSecretsStore() }),
		],
	});
	runSync(interp, prelude);
	return interp;
}
