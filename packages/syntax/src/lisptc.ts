import { tokenPattern } from "@repo/shared/lisp-tokens";
import {
	createHighlighter,
	defineLanguage,
	type TokenRange,
} from "@tanstack/highlight/core";

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const QUOTE = new Set(["'", "`", "~", ",", ",@"]);

interface Scan {
	ranges: TokenRange[];
	openForms: number;
	heads: string[];
	spans: [number, number][];
}

export interface Forms {
	prose: string;
	heads: string[];
}

function atomClass(text: string, head: boolean): TokenRange["className"] {
	if (text.startsWith(":")) return "attr";
	if (NUMBER.test(text)) return "number";
	return head ? "function" : "variable";
}

function scan(text: string): Scan {
	const token = tokenPattern();
	const ranges: TokenRange[] = [];
	const heads: string[] = [];
	const spans: [number, number][] = [];
	let formStart = -1;
	let depth = 0;
	let head = false;
	let base = 0;
	let quoteAt = -1;
	let quoteEnd = -1;

	const push = (
		start: number,
		end: number,
		className: TokenRange["className"],
	) => {
		if (depth > 0) ranges.push({ className, start, end });
	};

	for (const line of text.split("\n")) {
		for (let m = token.exec(line); m !== null; m = token.exec(line)) {
			const word = m[1];
			if (word === undefined) continue;
			const start = base + m.index;
			const end = start + word.length;

			if (QUOTE.has(word)) {
				if (depth > 0) push(start, end, "operator");
				else if (quoteEnd !== start) quoteAt = start;
				quoteEnd = end;
				continue;
			}

			const from = quoteEnd === start && quoteAt >= 0 ? quoteAt : start;
			quoteAt = -1;
			quoteEnd = -1;

			if (word === "(") {
				if (depth === 0) formStart = from;
				depth += 1;
				head = true;
				push(from, end, "operator");
			} else if (word === ")") {
				push(start, end, "operator");
				if (depth > 0) depth -= 1;
				if (depth === 0 && formStart >= 0) {
					spans.push([formStart, end]);
					formStart = -1;
				}
			} else if (word === '"') {
				push(start, base + line.length, "string");
				token.lastIndex = 0;
				break;
			} else if (word.startsWith('"')) {
				push(start, end, "string");
				head = false;
			} else {
				push(start, end, atomClass(word, head));
				if (head) heads.push(word);
				head = false;
			}
		}
		base += line.length + 1;
		quoteAt = -1;
		quoteEnd = -1;
	}

	if (formStart >= 0) spans.push([formStart, text.length]);

	return { ranges, openForms: depth, heads, spans };
}

export const lisptc = defineLanguage({
	name: "lisptc",
	aliases: ["lisp", "ptc"],
	tokenize: (code) => scan(code).ranges,
});

export const highlighter = createHighlighter({ languages: [lisptc] });

export function formsIn(text: string, skipped: readonly string[] = []): Forms {
	const { spans } = scan(text);
	const heads: string[] = [];
	let prose = "";
	let at = 0;
	for (const [start, end] of spans) {
		const inner = scan(text.slice(start, end));
		if (inner.heads[0] !== undefined && skipped.includes(inner.heads[0]))
			continue;
		prose += text.slice(at, start);
		at = end;
		heads.push(...inner.heads);
	}
	prose += text.slice(at);
	return {
		prose: prose
			.replace(/[ \t]{2,}/g, " ")
			.replace(/\n{3,}/g, "\n\n")
			.trim(),
		heads: [...new Set(heads)],
	};
}

export function openForms(text: string): number {
	return scan(text).openForms;
}
