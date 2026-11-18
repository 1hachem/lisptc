import { boot, Interp, runSync } from "@repo/interpreter/lisp";
import { str } from "@repo/interpreter/print";
import { MapSecretsStore } from "../src/ports.ts";
import { secretsExtension } from "../src/secrets.ts";
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
	boot(interp);
	return interp;
}
