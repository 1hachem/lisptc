import {
	Cell,
	endOfForm,
	type Interp,
	type InterpExtension,
	isSpecialForm,
	LispKeyword,
	readFailure,
	Sym,
	str,
} from "./lisp.ts";

export type ProseClassifier = (
	interp: Interp,
	form: unknown,
) => string | undefined;

export function proseExtension(
	classify: ProseClassifier = readsAsProse,
): InterpExtension {
	return (interp) => {
		interp.hooks.unclosedForm.use(
			(text, at) => `unclosed "(" on line ${lineAt(text, at)}`,
		);
		interp.hooks.unreadableForm.use(
			(text, start, end, next) =>
				unreadable(text, start, end) ?? next(text, start, end),
		);
		interp.hooks.skipForm.use(
			(interp, form, next) => classify(interp, form) ?? next(interp, form),
		);
	};
}

function unreadable(
	text: string,
	start: number,
	end: number,
): string | undefined {
	const source = text.slice(start, end);
	const failure = readFailure(source);
	if (failure === undefined) return undefined;
	const line = lineAt(text, start) + failure.line - 1;
	return `${abbreviate(source)} — ${failure.reason} on line ${line}, so this was read as prose`;
}

export const readsAsProse: ProseClassifier = (interp, form) => {
	const reason = proseReason(interp, form);
	if (reason === undefined) return undefined;
	return `${abbreviate(str(form))} — ${reason}, so this was read as prose`;
};

function proseReason(interp: Interp, form: unknown): string | undefined {
	if (!(form instanceof Cell)) return undefined;
	const head = form.car;
	if (head instanceof Sym && (isSpecialForm(head) || interp.hasGlobal(head)))
		return undefined;
	if (readsAsSentence(form)) return "a comma-separated phrase";
	if (!(head instanceof Sym)) return undefined;
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

function isNamespaced(name: string): boolean {
	return name.includes("/") || name.includes("_");
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
