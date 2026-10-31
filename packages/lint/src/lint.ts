import type { Interp } from "@repo/interpreter/lisp";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { type Problem, problemsIn, rejection, unclosedIn } from "./check.ts";

function formsAsRead(interp: Interp, code: string): string {
	return interp.hooks.readSource.run((_i, text) => text, interp, code);
}

export function checkSource(interp: Interp, code: string): Problem[] {
	const unclosed = unclosedIn(code);
	if (unclosed === undefined)
		return problemsIn(formsAsRead(interp, code), interp);
	const before = code.slice(0, unclosed.at);
	return [...problemsIn(formsAsRead(interp, before), interp), unclosed.problem];
}

export function lintExtension(): InterpExtension {
	return Object.assign((_interp: Interp): void => {}, {
		session(hooks: SessionHooks): void {
			hooks.admit.use(async (interp, code, next) => {
				const problems = checkSource(interp, code).filter(
					(problem) => problem.severity === "error",
				);
				if (problems.length === 0) return next(interp, code);
				return {
					code,
					rejected: rejection(problems),
					problems: problems.map(({ line, message }) => ({ line, message })),
				};
			});
		},
	});
}
