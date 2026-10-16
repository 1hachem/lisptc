import type { Interp } from "@repo/interpreter/lisp";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { type Problem, problemsIn, rejection, unclosedIn } from "./check.ts";

function formsAsRead(interp: Interp, code: string): string {
	return interp.hooks.readSource.run((_i, text) => text, interp, code);
}

export type { Problem } from "./check.ts";

export function checkSource(interp: Interp, code: string): Problem[] {
	const unclosed = unclosedIn(code);
	if (unclosed !== undefined) return [unclosed];
	return problemsIn(formsAsRead(interp, code), interp);
}

export function lintExtension(): InterpExtension {
	return Object.assign((_interp: Interp): void => {}, {
		session(hooks: SessionHooks): void {
			hooks.admit.use(async (interp, code, next) => {
				const problems = checkSource(interp, code);
				if (problems.length === 0) return next(interp, code);
				return { code, rejected: rejection(problems) };
			});
		},
	});
}
