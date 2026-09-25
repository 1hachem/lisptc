import { isNumeric } from "@repo/interpreter/arith";
import type { Interp } from "@repo/interpreter/lisp";
import {
	Cell,
	isSpecialForm,
	LispKeyword,
	Sym,
} from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import type { Awaitable, PromptSource } from "@repo/shared/host";
import { looksLikeParenthesizedProse } from "@repo/shared/lisp-prose";

export interface ProseClassification {
	readonly reason: string;
}

export type ProseClassifier = (
	interp: Interp,
	form: unknown,
) => Awaitable<ProseClassification | undefined>;

export interface ProseHost {
	readonly classifiers: readonly ProseClassifier[];
	readonly prompt: PromptSource;
}

export function readsAsProse(
	interp: Interp,
	form: unknown,
): ProseClassification | undefined {
	const reason = proseReason(interp, form);
	if (reason === undefined) return undefined;
	return { reason };
}

function proseReason(interp: Interp, form: unknown): string | undefined {
	if (!(form instanceof Cell)) return undefined;
	const head = form.car;
	if (head instanceof Sym && (isSpecialForm(head) || interp.hasGlobal(head)))
		return undefined;
	if (hasKnownCall(interp, form) && !hasWord(form)) return undefined;
	if (looksLikeParenthesizedProse(str(form)))
		return head instanceof Sym
			? `"${head.name}" is not defined`
			: isLiteral(head)
				? `${str(head)} is not a function`
				: "the parenthesized text looks like prose";
	if (!(head instanceof Sym))
		return isLiteral(head) ? `${str(head)} is not a function` : undefined;
	if (marksCode(form)) return undefined;
	if (isNamespaced(head.name) && !hasWord(form)) return undefined;
	return `"${head.name}" is not defined`;
}

export function isKnownCall(interp: Interp, form: unknown): form is Cell {
	if (!(form instanceof Cell)) return false;
	const head = form.car;
	return head instanceof Sym && !isSpecialForm(head) && interp.hasGlobal(head);
}

function hasKnownCall(interp: Interp, form: Cell): boolean {
	for (let rest: unknown = form.cdr; rest instanceof Cell; rest = rest.cdr)
		if (isKnownCall(interp, rest.car)) return true;
	return false;
}

function marksCode(form: Cell): boolean {
	for (let rest: unknown = form.cdr; rest instanceof Cell; rest = rest.cdr) {
		const arg = rest.car;
		if (arg instanceof LispKeyword || typeof arg === "string") return true;
	}
	return false;
}

function isLiteral(head: unknown): boolean {
	return isNumeric(head) || typeof head === "string";
}

const NAMESPACED = /^[a-z][a-z0-9-]*[/_][a-z0-9_/-]*$/i;

function isNamespaced(name: string): boolean {
	return NAMESPACED.test(name);
}

function hasWord(form: Cell): boolean {
	for (let rest: unknown = form.cdr; rest instanceof Cell; rest = rest.cdr)
		if (rest.car instanceof Sym) return true;
	return false;
}
