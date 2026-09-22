import { isNumeric } from "@repo/interpreter/arith";
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
} from "@repo/interpreter/lisp";
import type { SessionHooks } from "@repo/interpreter/session";
import { note } from "@repo/interpreter/topics";
import type { Awaitable, PromptSource } from "@repo/shared/host";
import {
	endOfForm,
	type FormJudge,
	formSpans,
	formsOnly,
	type Skipped,
} from "@repo/shared/lisp-forms";
import { looksLikeParenthesizedProse } from "@repo/shared/lisp-prose";
import { proseHost } from "./prose-host.ts";

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

export function proseExtension(host: ProseHost = proseHost): InterpExtension {
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
		interp.hooks.failedForm.use(function* (interp, form, error, next) {
			for (const classifier of host.classifiers) {
				const classification = yield* settled(classifier(interp, form));
				if (classification !== undefined)
					return `${abbreviate(str(form))} — ${classification.reason}, so this was read as prose`;
			}
			return yield* next(interp, form, error);
		});
	};
	return Object.assign(extension, {
		prompt: host.prompt(),
		session(hooks: SessionHooks): void {
			hooks.unrun.use((interp, code, next) => [
				...next(interp, code),
				...proseSkipped(interp, code),
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
		const reason = unreadableReason(text, start, end);
		if (reason === undefined) return undefined;
		return `${abbreviate(text.slice(start, end))} — ${reason}, so this was read as prose`;
	},
};

function unreadableReason(
	text: string,
	start: number,
	end: number,
): string | undefined {
	const failure = readFailure(text.slice(start, end));
	if (failure === undefined) return undefined;
	return `${failure.reason} on line ${lineAt(text, start) + failure.line - 1}`;
}

export function stripProse(
	text: string,
	onSkip?: (what: string) => void,
): string {
	return formsOnly(text, proseJudge, onSkip);
}

export function proseSkipped(interp: Interp, text: string): Skipped[] {
	const skipped: Skipped[] = [];
	for (const span of formSpans(text)) {
		const [start, end] = span;
		const unreadable = unreadableReason(text, start, end);
		if (unreadable !== undefined) {
			skipped.push({ span, reason: unreadable });
			continue;
		}
		const classification = readsAsProse(
			interp,
			readForm(text.slice(start, end)),
		);
		if (classification !== undefined)
			skipped.push({ span, reason: classification.reason });
	}
	return skipped;
}

function readForm(source: string): unknown {
	const tokens = new Reader();
	tokens.push(source);
	return tokens.read();
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
	if (hasKnownCall(interp, form)) return undefined;
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

function hasKnownCall(interp: Interp, form: Cell): boolean {
	for (let rest: unknown = form.cdr; rest instanceof Cell; rest = rest.cdr) {
		const arg = rest.car;
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
