import { tokenPattern } from "./lisp-tokens.ts";

export interface FormJudge {
	unclosed(text: string, at: number): string | undefined;
	unreadable(text: string, start: number, end: number): string | undefined;
}

export type FormSpan = [start: number, end: number];

export interface Skipped {
	readonly span: FormSpan;
	readonly reason: string;
}

export function endOfForm(text: string, i: number): number {
	const token = tokenPattern();
	token.lastIndex = i;
	let depth = 0;
	for (let m = token.exec(text); m !== null; m = token.exec(text)) {
		const word = m[1];
		if (word === '"') return -1;
		if (word === "(") depth++;
		else if (word === ")") {
			depth--;
			if (depth === 0) return m.index + 1;
		}
	}
	return -1;
}

function startOfForm(text: string, i: number): number {
	let j = i;
	while (j > 0 && "'`,@".includes(text[j - 1])) j--;
	return j === 0 || /\s/.test(text[j - 1]) ? j : i;
}

export function formSpans(
	text: string,
	judge?: FormJudge,
	onSkip?: (what: string) => void,
): FormSpan[] {
	const spans: FormSpan[] = [];
	let i = 0;
	while (i < text.length) {
		if (text[i] !== "(") {
			i++;
			continue;
		}
		const end = endOfForm(text, i);
		const start = startOfForm(text, i);
		if (end < 0) {
			const stray = judge?.unclosed(text, i);
			if (stray !== undefined) {
				onSkip?.(stray);
				i++;
				continue;
			}
			spans.push([start, text.length]);
			break;
		}
		const unreadable = judge?.unreadable(text, start, end);
		if (unreadable !== undefined) {
			onSkip?.(unreadable);
			i = end;
			continue;
		}
		spans.push([start, end]);
		i = end;
	}
	return spans;
}

export function formsOnly(
	text: string,
	judge?: FormJudge,
	onSkip?: (what: string) => void,
): string {
	const out: string[] = [...text.replace(/[^\n]/g, " ")];
	for (const [start, end] of formSpans(text, judge, onSkip))
		for (let j = start; j < end; j++) out[j] = text[j];
	return out.join("");
}

export interface OpenAtEnd {
	readonly parens: readonly number[];
	readonly inString: boolean;
}

export function openAtEnd(text: string): OpenAtEnd {
	const parens: number[] = [];
	const token = tokenPattern();
	for (let m = token.exec(text); m !== null; m = token.exec(text)) {
		const word = m[1];
		if (word === undefined) continue;
		if (word.startsWith('"')) {
			if (parens.length === 0) token.lastIndex = m.index + 1;
			else if (word === '"') return { parens, inString: true };
		} else if (word === "(") parens.push(m.index);
		else if (word === ")") parens.pop();
	}
	return { parens, inString: false };
}

export function openForms(text: string): number {
	return openAtEnd(text).parens.length;
}
