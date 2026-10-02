import type { Doc } from "@repo/interpreter/docs";
import {
	type EvalException,
	UnresolvedHead,
	VoidVariable,
} from "@repo/interpreter/errors";
import { ArityException, KeywordException } from "@repo/interpreter/func";
import type { Interp } from "@repo/interpreter/lisp";
import type { InterpExtension } from "@repo/interpreter/session";
import type { SearchEngine } from "@repo/shared/search";
import { type DiagnosticsHost, nearest } from "./ports.ts";

function shown(name: string, doc: Doc | undefined): string {
	return doc === undefined ? name : `${name}  ${doc.signature}`;
}

function expected({ min, max }: { min: number; max?: number }): string {
	if (max === undefined) return `${min} or more`;
	return min === max ? `${min}` : `${min} to ${max}`;
}

function suggestion(
	search: SearchEngine,
	interp: Interp,
	error: UnresolvedHead,
): string | undefined {
	if (error.why !== "undefined") return undefined;
	const missing = error.callee;
	if (missing === undefined) return undefined;
	const best = nearest(search, missing, interp.globalNames());
	if (best === undefined) return undefined;
	return `${String(error)}\ndid you mean ${shown(best, interp.docs().get(best))}`;
}

function howItIsCalled(
	interp: Interp,
	error: EvalException,
): string | undefined {
	const name = error.callee;
	if (name === undefined) return undefined;
	const doc = interp.docs().get(name);
	if (doc === undefined) return undefined;
	const head =
		error instanceof ArityException
			? error.reportedAs(
					`arity not matched: ${name} — given ${error.given}, takes ${expected(error.expected)}`,
				)
			: String(error);
	return `${head}\n${doc.signature}`;
}

function byName(
	search: SearchEngine,
	interp: Interp,
	error: VoidVariable,
): string | undefined {
	const best = nearest(search, error.variable, interp.globalNames());
	if (best === undefined) return undefined;
	return `${String(error)}\ndid you mean ${shown(best, interp.docs().get(best))}`;
}

function byKeyword(
	search: SearchEngine,
	interp: Interp,
	error: KeywordException,
): string | undefined {
	const lines = [String(error)];
	const best =
		error.key === undefined
			? undefined
			: nearest(search, error.key, error.accepted);
	if (best !== undefined) lines.push(`did you mean :${best}`);
	else if (error.accepted.length > 0)
		lines.push(`it takes ${error.accepted.map((k) => `:${k}`).join(" ")}`);
	const doc =
		error.callee === undefined ? undefined : interp.docs().get(error.callee);
	if (doc !== undefined) lines.push(doc.signature);
	return lines.join("\n");
}

function advice(
	search: SearchEngine,
	interp: Interp,
	error: EvalException,
): string | undefined {
	if (error instanceof UnresolvedHead) return suggestion(search, interp, error);
	if (error instanceof VoidVariable) return byName(search, interp, error);
	if (error instanceof KeywordException)
		return byKeyword(search, interp, error);
	return howItIsCalled(interp, error);
}

export function diagnosticsExtension(host: DiagnosticsHost): InterpExtension {
	const extension = (interp: Interp): void => {
		interp.hooks.failedForm.use(function* (interp, form, error, next) {
			const reported = advice(host.search, interp, error);
			if (reported === undefined) return yield* next(interp, form, error);
			return { reported };
		});
	};
	return Object.assign(extension, { prompt: host.prompt() });
}
