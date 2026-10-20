export interface FormJudge {
	unclosed(text: string, at: number): string | undefined;
	unreadable(text: string, start: number, end: number): string | undefined;
}

export type FormSpan = [start: number, end: number];

export interface Skipped {
	readonly span: FormSpan;
	readonly reason: string;
}

function stringFrom(text: string, i: number): { end: number; closed: boolean } {
	for (let j = i + 1; j < text.length; j++) {
		const c = text[j];
		if (c === "\n") return { end: j, closed: false };
		if (c === "\\") j++;
		else if (c === '"') return { end: j + 1, closed: true };
	}
	return { end: text.length, closed: false };
}

function endOfString(text: string, i: number): number {
	return stringFrom(text, i).end;
}

export function endOfForm(text: string, i: number): number {
	let depth = 0;
	for (let j = i; j < text.length; j++) {
		const c = text[j];
		if (c === '"') {
			j = endOfString(text, j) - 1;
		} else if (c === "(") {
			depth++;
		} else if (c === ")") {
			depth--;
			if (depth === 0) return j + 1;
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
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '"' && parens.length > 0) {
			const { end, closed } = stringFrom(text, i);
			if (end === text.length && !closed) return { parens, inString: true };
			i = end - 1;
		} else if (c === "(") parens.push(i);
		else if (c === ")") parens.pop();
	}
	return { parens, inString: false };
}

export function openForms(text: string): number {
	return openAtEnd(text).parens.length;
}
