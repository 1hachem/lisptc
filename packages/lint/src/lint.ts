import type { Interp } from "@repo/interpreter/lisp";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { problemsIn, rejection } from "./check.ts";

function formsAsRead(interp: Interp, code: string): string {
	return interp.hooks.readSource.run((_i, text) => text, interp, code);
}

export function lintExtension(): InterpExtension {
	return Object.assign((_interp: Interp): void => {}, {
		session(hooks: SessionHooks): void {
			hooks.admit.use(async (interp, code, next) => {
				const problems = problemsIn(formsAsRead(interp, code), interp);
				if (problems.length === 0) return next(interp, code);
				return { code, rejected: rejection(problems) };
			});
		},
	});
}
