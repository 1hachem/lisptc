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
import { annotating, type SessionHooks } from "@repo/interpreter/session";
import { note } from "@repo/interpreter/topics";
import type { Awaitable, PromptSource } from "@repo/shared/host";
import {
	endOfForm,
	type FormJudge,
	type FormSpan,
	formSpans,
	formsOnly,
} from "@repo/shared/lisp-forms";
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

export type ProseSense = string | false;

export interface ProseSpans {
	readonly code: string;
	readonly spans: readonly string[];
	readonly bound: readonly string[];
}

export type ProseSort = (
	spans: ProseSpans,
) => Awaitable<ReadonlyMap<string, ProseSense>>;

export interface ProseHost {
	classify: ProseClassifier;
	sort: ProseSort;
	excuse: ProseExcuse;
	prompt: PromptSource;
}

export function proseExtension(host: ProseHost = proseHost): InterpExtension {
	const { classify, sort, excuse } = host;
	const sensed = new Map<string, ProseSense>();
	const step = newStep();
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
		interp.hooks.skipForm.use((interp, form, next) => {
			const span = str(form);
			const sense = sensed.get(span);
			const skipped =
				sense === false
					? next(interp, form)
					: (sense ?? classify(interp, form) ?? next(interp, form));
			if (skipped !== undefined) step.unrun.add(span);
			return skipped;
		});
		interp.hooks.failedForm.use(function* (interp, form, error, next) {
			const span = str(form);
			const excused =
				sensed.get(span) === false
					? yield* next(interp, form, error)
					: ((yield* settled(excuse(interp, form, error))) ??
						(yield* next(interp, form, error)));
			if (excused !== undefined) step.unrun.add(span);
			return excused;
		});
	};
	return Object.assign(extension, {
		prompt: host.prompt(),
		session(hooks: SessionHooks): void {
			hooks.evalStep.use(async (ctx, next) => {
				sensed.clear();
				openStep(step, ctx.interp, ctx.code);
				const asking = unsureSpans(step, ctx.code);
				if (asking.spans.length > 0)
					for (const [span, sense] of await sort(asking))
						sensed.set(span, sense);
				await next(ctx);
			});
			hooks.annotate.use((buffer, into, next) => {
				const ranges = closeStep(step);
				return next(
					buffer,
					ranges === undefined
						? into
						: annotating(into, "output", { unrun: ranges }),
				);
			});
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

interface StepSpan {
	at: FormSpan;
	span: string;
	sure: boolean;
	head: string | undefined;
}

interface Step {
	opened: boolean;
	spans: StepSpan[];
	blanked: FormSpan[];
	unrun: Set<string>;
}

function newStep(): Step {
	return { opened: false, spans: [], blanked: [], unrun: new Set() };
}

function clearStep(step: Step): void {
	step.opened = false;
	step.spans = [];
	step.blanked = [];
	step.unrun.clear();
}

function openStep(step: Step, interp: Interp, text: string): void {
	clearStep(step);
	step.opened = true;
	const judge: FormJudge = {
		unclosed(source, at) {
			const said = proseJudge.unclosed(source, at);
			if (said !== undefined) step.blanked.push([at, source.length]);
			return said;
		},
		unreadable(source, start, end) {
			const said = proseJudge.unreadable(source, start, end);
			if (said !== undefined) step.blanked.push([start, end]);
			return said;
		},
	};
	for (const at of formSpans(text, judge)) {
		const form = readOne(text.slice(at[0], at[1]));
		if (form === undefined) continue;
		step.spans.push({
			at,
			span: str(form),
			sure: certainly(interp, form) === false,
			head:
				form instanceof Cell && form.car instanceof Sym
					? form.car.name
					: undefined,
		});
	}
}

function closeStep(step: Step): FormSpan[] | undefined {
	if (!step.opened) return undefined;
	const ranges = [
		...step.blanked,
		...step.spans.filter((span) => step.unrun.has(span.span)).map((s) => s.at),
	].sort((a, b) => a[0] - b[0]);
	clearStep(step);
	return ranges;
}

function readOne(source: string): unknown {
	const tokens = new Reader();
	tokens.push(source);
	try {
		return tokens.read();
	} catch {
		return undefined;
	}
}

function unsureSpans(step: Step, code: string): ProseSpans {
	const spans = new Set<string>();
	const bound = new Set<string>();
	for (const span of step.spans) {
		if (!span.sure) spans.add(span.span);
		else if (span.head !== undefined) bound.add(span.head);
	}
	return { code, spans: [...spans], bound: [...bound] };
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

export function noSort(): ReadonlyMap<string, ProseSense> {
	return new Map();
}

function certainly(interp: Interp, form: unknown): false | undefined {
	if (!(form instanceof Cell)) return false;
	const head = form.car;
	if (head instanceof Sym && (isSpecialForm(head) || interp.hasGlobal(head)))
		return false;
	return undefined;
}

export function skippedAsProse(form: unknown, reason: string): string {
	return `${abbreviate(str(form))} — ${reason}, so this was read as prose`;
}

export function readsAsProse(
	interp: Interp,
	form: unknown,
): string | undefined {
	const reason = proseReason(interp, form);
	if (reason === undefined) return undefined;
	return skippedAsProse(form, reason);
}

function proseReason(interp: Interp, form: unknown): string | undefined {
	if (certainly(interp, form) === false) return undefined;
	if (!(form instanceof Cell)) return undefined;
	const head = form.car;
	if (readsAsSentence(form)) return "a comma-separated phrase";
	if (!(head instanceof Sym))
		return isLiteral(head) ? `${str(head)} is not a function` : undefined;
	if (marksCode(interp, form)) return undefined;
	if (isNamespaced(head.name) && !hasWord(form)) return undefined;
	return `"${head.name}" is not defined`;
}

const CLAUSE = /,$/;

function readsAsSentence(form: Cell): boolean {
	for (let rest: unknown = form; rest instanceof Cell; rest = rest.cdr)
		if (rest.car instanceof Sym && CLAUSE.test(rest.car.name)) return true;
	return false;
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

const NAMESPACED = /^[a-z][\w-]*[/_][\w/-]*$/i;

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
