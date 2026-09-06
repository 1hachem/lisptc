import type { TextDocument } from "vscode-languageserver-textdocument";

const symbolChar = /[^()'`~" \t]/;

export function enclosingCallHead(
	document: TextDocument,
	position: { line: number; character: number },
): string | undefined {
	const text = document.getText({
		start: { line: 0, character: 0 },
		end: position,
	});
	let depth = 0;
	for (let i = text.length - 1; i >= 0; i--) {
		const c = text[i];
		if (c === ")") {
			depth++;
		} else if (c === "(") {
			if (depth === 0) {
				let j = i + 1;
				while (j < text.length && /\s/.test(text[j])) j++;
				let k = j;
				while (k < text.length && symbolChar.test(text[k])) k++;
				return k > j ? text.slice(j, k) : undefined;
			}
			depth--;
		}
	}
	return undefined;
}

export function symbolAt(
	document: TextDocument,
	line: number,
	character: number,
) {
	const text = document.getText({
		start: { line, character: 0 },
		end: { line: line + 1, character: 0 },
	});
	let start = character;
	let end = character;
	while (start > 0 && symbolChar.test(text[start - 1])) start--;
	while (end < text.length && symbolChar.test(text[end])) end++;
	if (start === end) return undefined;
	return {
		name: text.slice(start, end),
		range: {
			start: { line, character: start },
			end: { line, character: end },
		},
	};
}

export function markdownFor(sig?: string, doc?: string): string | undefined {
	if (sig === undefined && (doc === undefined || doc === "")) return undefined;
	const body = doc ?? "";
	return sig === undefined ? body : `\`\`\`lisp\n${sig}\n\`\`\`\n${body}`;
}
