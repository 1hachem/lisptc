import {
	Cell,
	EndOfFile,
	type Eval,
	EvalException,
	type Interp,
	type InterpExtension,
	Reader,
	readFailure,
	settled,
	str,
} from "@repo/interpreter/lisp";
import type { SessionHooks } from "@repo/interpreter/session";
import { note } from "@repo/interpreter/topics";
import {
	endOfForm,
	type FormJudge,
	type FormSpan,
	formSpans,
	formsOnly,
	type Skipped,
} from "@repo/shared/lisp-forms";
import { isKnownCall, type ProseHost, readsAsProse } from "./ports.ts";

export function proseExtension(host: ProseHost): InterpExtension {
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
				if (classification === undefined) continue;
				const ran = form instanceof Cell ? yield* runNested(interp, form) : 0;
				const read = `${abbreviate(str(form))} — ${classification.reason}, so this was read as prose`;
				return ran === 0
					? read
					: `${read}, and the ${ran === 1 ? "form" : "forms"} inside it ran`;
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
		if (classification === undefined) continue;
		for (const gap of around(ranSpans(interp, text, start, end), start, end))
			skipped.push({ span: gap, reason: classification.reason });
	}
	return skipped;
}

function ranSpans(
	interp: Interp,
	text: string,
	start: number,
	end: number,
): FormSpan[] {
	const open = text.indexOf("(", start);
	if (open < 0 || open >= end) return [];
	const at = open + 1;
	const spans: FormSpan[] = [];
	for (const [from, to] of formSpans(text.slice(at, end - 1))) {
		const inner = text.slice(at + from, at + to);
		if (unreadableReason(text, at + from, at + to) !== undefined) continue;
		if (isKnownCall(interp, readForm(inner))) spans.push([at + from, at + to]);
		else spans.push(...ranSpans(interp, text, at + from, at + to));
	}
	return spans;
}

function around(
	ran: readonly FormSpan[],
	start: number,
	end: number,
): FormSpan[] {
	const gaps: FormSpan[] = [];
	let at = start;
	for (const [from, to] of ran) {
		if (from > at) gaps.push([at, from]);
		at = to;
	}
	if (end > at) gaps.push([at, end]);
	return gaps;
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

function* runNested(interp: Interp, form: Cell): Eval<number> {
	let ran = 0;
	for (let rest: unknown = form.cdr; rest instanceof Cell; rest = rest.cdr) {
		const arg = rest.car;
		if (isKnownCall(interp, arg)) {
			yield* interp.evalGen(arg, null);
			ran++;
		} else if (arg instanceof Cell) ran += yield* runNested(interp, arg);
	}
	return ran;
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
