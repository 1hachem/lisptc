import type { Awaitable, PromptSource } from "@repo/shared/host";
import { endOfForm, type FormJudge, formsOnly } from "@repo/shared/lisp-forms";
import { isNumeric } from "@repo/interpreter/arith";
import { noOpinion } from "@repo/interpreter/hooks";
import {
	Cell,
	EndOfFile,
	EvalException,
	type Interp,
	type InterpExtension,
	isSpecialForm,
	LispKeyword,
	Reader,
	readFailure,
	Sym,
	settled,
	str,
	type UnresolvedHead,
} from "@repo/interpreter/lisp";
import type { SessionHooks } from "@repo/interpreter/session";
import { note } from "@repo/interpreter/topics";
import { proseHost } from "./prose-host.ts";

export type ProseClassifier = (
	interp: Interp,
	form: unknown,
) => string | undefined;

export type ProseExcuse = (
	interp: Interp,
	form: unknown,
	error: UnresolvedHead,
) => Awaitable<string | undefined>;

export interface ProseHost {
	classify: ProseClassifier;
	excuse: ProseExcuse;
	prompt: PromptSource;
}

export function proseExtension(host: ProseHost = proseHost): InterpExtension {
	const { classify, excuse } = host;
	const extension = (interp: Interp): void => {
		interp.hooks.readSource.use((interp, text, next) =>
			next(
				interp,
				stripProse(text, (what) =>
					note.emit(interp.channels, {
						model: { kind: "skipped", text: what },
					}),
				),
			),
		);
		interp.hooks.skipForm.use(
			(interp, form, next) => classify(interp, form) ?? next(interp, form),
		);
		interp.hooks.failedForm.use(function* (interp, form, error, next) {
			return (
				(yield* settled(excuse(interp, form, error))) ??
				(yield* next(interp, form, error))
			);
		});
	};
	return Object.assign(extension, {
		prompt: host.prompt(),
		session(hooks: SessionHooks): void {
			hooks.unrun.use((interp, code, next) => [
				...next(interp, code),
				...proseHeads(interp, code),
			]);
			hooks.answered.use((ctx, out, next) => {
				if (formsOnly(ctx.code).trim() === "") return true;
				if (out.model !== "" || out.skipped.length === 0) return next(ctx, out);
				return !isTruncated(ctx.code);
			});
		},
	});
}

const proseJudge: FormJudge = {
	unclosed: (text, at) => `unclosed "(" on line ${lineAt(text, at)}`,
	unreadable(text, start, end) {
		const source = text.slice(start, end);
		const failure = readFailure(source);
		if (failure === undefined) return undefined;
		const line = lineAt(text, start) + failure.line - 1;
		return `${abbreviate(source)} — ${failure.reason} on line ${line}, so this was read as prose`;
	},
};

export function stripProse(
	text: string,
	onSkip?: (what: string) => void,
): string {
	return formsOnly(text, proseJudge, onSkip);
}

export function proseHeads(interp: Interp, text: string): string[] {
	const tokens = new Reader();
	tokens.push(stripProse(text));
	const heads: string[] = [];
	while (!tokens.isEmpty()) {
		let exp: unknown;
		try {
			exp = tokens.read();
		} catch {
			break;
		}
		if (interp.hooks.skipForm.run(noOpinion, interp, exp) === undefined)
			continue;
		if (exp instanceof Cell && exp.car instanceof Sym) heads.push(exp.car.name);
	}
	return heads;
}

export interface SyntaxError_ {
	message: string;
	line: number;
}

export function checkSyntax(text: string): SyntaxError_[] {
	const tokens = new Reader();
	tokens.push(formsOnly(text));
	while (!tokens.isEmpty()) {
		try {
			tokens.read();
		} catch (ex) {
			if (ex === EndOfFile)
				return [
					{
						message: "unexpected end of input (unbalanced parentheses?)",
						line: tokens.line,
					},
				];
			if (ex instanceof EvalException)
				return [{ message: String(ex.message), line: tokens.line }];
			throw ex;
		}
	}
	return [];
}

export function noExcuse(): undefined {
	return undefined;
}

export function readsAsProse(
	interp: Interp,
	form: unknown,
): string | undefined {
	const reason = proseReason(interp, form);
	if (reason === undefined) return undefined;
	return `${abbreviate(str(form))} — ${reason}, so this was read as prose`;
}

function proseReason(interp: Interp, form: unknown): string | undefined {
	if (!(form instanceof Cell)) return undefined;
	const head = form.car;
	if (head instanceof Sym && (isSpecialForm(head) || interp.hasGlobal(head)))
		return undefined;
	if (readsAsSentence(form)) return "a comma-separated phrase";
	if (!(head instanceof Sym))
		return isLiteral(head) ? `${str(head)} is not a function` : undefined;
	if (marksCode(interp, form)) return undefined;
	if (isNamespaced(head.name) && !hasWord(form)) return undefined;
	return `"${head.name}" is not defined`;
}

const SENTENCE_WORDS = 4;

function readsAsSentence(form: Cell): boolean {
	let words = 0;
	let clauses = 0;
	for (let rest: unknown = form; rest instanceof Cell; rest = rest.cdr) {
		const word = rest.car;
		if (word instanceof Cell || word instanceof LispKeyword) return false;
		if (typeof word === "string") return false;
		if (word instanceof Sym && word.name.endsWith(",")) clauses++;
		words++;
	}
	return clauses > 0 && words >= SENTENCE_WORDS;
}

function marksCode(interp: Interp, form: Cell): boolean {
	for (let rest: unknown = form.cdr; rest instanceof Cell; rest = rest.cdr) {
		const arg = rest.car;
		if (arg instanceof LispKeyword || typeof arg === "string") return true;
		if (arg instanceof Cell) {
			const inner = arg.car;
			if (
				inner instanceof Sym &&
				!isSpecialForm(inner) &&
				interp.hasGlobal(inner)
			)
				return true;
		}
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

export function isTruncated(text: string): boolean {
	let i = 0;
	while (i < text.length) {
		if (text[i] !== "(") {
			i++;
			continue;
		}
		const end = endOfForm(text, i);
		if (end < 0) return true;
		i = end;
	}
	return false;
}

function lineAt(text: string, at: number): number {
	let line = 1;
	for (let i = 0; i < at; i++) if (text[i] === "\n") line++;
	return line;
}

function abbreviate(text: string): string {
	const oneLine = text.replace(/\s+/g, " ");
	return oneLine.length <= 60 ? oneLine : `${oneLine.slice(0, 57)}...`;
}
