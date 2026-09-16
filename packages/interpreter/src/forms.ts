export interface FormJudge {
	unclosed(text: string, at: number): string | undefined;
	unreadable(text: string, start: number, end: number): string | undefined;
}

function endOfString(text: string, i: number): number {
	for (let j = i + 1; j < text.length; j++) {
		const c = text[j];
		if (c === "\n") return j;
		if (c === "\\") j++;
		else if (c === '"') return j + 1;
	}
	return text.length;
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

export function formsOnly(
	text: string,
	judge?: FormJudge,
	onSkip?: (what: string) => void,
): string {
	const out: string[] = Array.from(text, (c) => (c === "\n" ? "\n" : " "));
	let i = 0;
	while (i < text.length) {
		if (text[i] !== "(") {
			i++;
			continue;
		}
		const end = endOfForm(text, i);
		if (end < 0) {
			const stray = judge?.unclosed(text, i);
			if (stray !== undefined) {
				onSkip?.(stray);
				i++;
				continue;
			}
			for (let j = startOfForm(text, i); j < text.length; j++) out[j] = text[j];
			break;
		}
		const start = startOfForm(text, i);
		const unreadable = judge?.unreadable(text, start, end);
		if (unreadable !== undefined) {
			onSkip?.(unreadable);
			i = end;
			continue;
		}
		for (let j = start; j < end; j++) out[j] = text[j];
		i = end;
	}
	return out.join("");
}
