import { Interp, runSync } from "@repo/interpreter/lisp";
import { jsonToLisp, newSym } from "@repo/interpreter/objects";
import { prelude } from "@repo/interpreter/prelude";
import {
	type Admission,
	type InterpExtension,
	openSession,
	type SessionHooks,
} from "@repo/interpreter/session";
import { recoveryExtension } from "../src/recovery.ts";
import { recoveryHost } from "../src/recovery-host.ts";

function opens(code: string): number {
	let open = 0;
	for (const ch of code) open += ch === "(" ? 1 : ch === ")" ? -1 : 0;
	return open;
}

function mistakeIn(code: string): string | undefined {
	if (code.includes("totl")) return "totl is not defined";
	if (opens(code) !== 0) return "unbalanced parentheses";
	if (code.includes("(load-mcp") && !code.includes(":name"))
		return 'load-mcp: missing required argument ":name"';
	return undefined;
}

const checker: InterpExtension = Object.assign((_interp: Interp): void => {}, {
	session(hooks: SessionHooks): void {
		hooks.admit.use(async (interp, code, next) => {
			const mistake = mistakeIn(code);
			return mistake === undefined
				? next(interp, code)
				: { code, rejected: mistake };
		});
	},
});

export interface World {
	interp: Interp;
	admit(code: string): Promise<Admission>;
	rejected(): unknown;
	stopped(code: string, lines: number[]): void;
	read(code: string): unknown;
}

export function world(): World {
	const extensions = [recoveryExtension(recoveryHost), checker];
	const interp = new Interp({ extensions });
	runSync(interp, prelude);
	const hooks = openSession(extensions);
	return {
		interp,
		admit: (code) =>
			hooks.admit.run(async (_i, c) => ({ code: c }), interp, code),
		rejected: () => interp.getGlobal(newSym("rejected")),
		stopped: (code, lines) =>
			interp.defineGlobal(
				newSym("conversation"),
				jsonToLisp([
					{ role: "user", content: "fix it" },
					{ role: "assistant", content: code },
					{
						role: "tool",
						content: "not run",
						problems: lines.map((line) => ({ line, message: `line ${line}` })),
					},
				]),
			),
		read: (code) => runSync(interp, code),
	};
}
