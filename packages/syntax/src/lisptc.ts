import { type FormSpan, formSpans } from "@repo/shared/lisp-forms";
import { looksLikeParenthesizedProse } from "@repo/shared/lisp-prose";
import { tokenPattern } from "@repo/shared/lisp-tokens";
import {
	createHighlighter,
	defineLanguage,
	type TokenRange,
} from "@tanstack/highlight/core";

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const QUOTE = new Set(["'", "`", "~", ",", ",@"]);
const QUOTES = new Set(["'", "`"]);
const UNQUOTES = new Set([",", ",@"]);

interface Scan {
	ranges: TokenRange[];
	heads: string[];
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
	const prose = formSpans(text).filter(([start, end]) =>
		looksLikeParenthesizedProse(text.slice(start, end)),
	);
	const ranges: TokenRange[] = [];
	const heads: string[] = [];
	const enclosing: boolean[] = [];
	let depth = 0;
	let head = false;
	let quoted = false;
	let mark: "quote" | "unquote" | undefined;
	let base = 0;
	let quoteAt = -1;
	let quoteEnd = -1;

	const push = (
		start: number,
		end: number,
		className: TokenRange["className"],
	) => {
		if (
			depth > 0 &&
			!prose.some(
				([proseStart, proseEnd]) => start >= proseStart && end <= proseEnd,
			)
		)
			ranges.push({ className, start, end });
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
				if (QUOTES.has(word)) mark = "quote";
				else if (UNQUOTES.has(word)) mark = "unquote";
				continue;
			}

			const from = quoteEnd === start && quoteAt >= 0 ? quoteAt : start;
			quoteAt = -1;
			quoteEnd = -1;

			if (word === "(") {
				enclosing.push(quoted);
				if (mark !== undefined) quoted = mark === "quote";
				depth += 1;
				head = true;
				push(from, end, "operator");
			} else if (word === ")") {
				push(start, end, "operator");
				if (depth > 0) {
					depth -= 1;
					quoted = enclosing.pop() ?? false;
				}
				head = false;
			} else if (word.startsWith('"')) {
				if (depth === 0) {
					const paren = word.indexOf("(", 1);
					if (paren >= 0) token.lastIndex = m.index + paren;
				} else if (word === '"') {
					push(start, base + line.length, "string");
					token.lastIndex = 0;
					break;
				} else {
					push(start, end, "string");
					head = false;
				}
			} else {
				push(start, end, atomClass(word, head && !quoted));
				if (
					head &&
					!quoted &&
					!prose.some(
						([proseStart, proseEnd]) => start >= proseStart && end <= proseEnd,
					)
				)
					heads.push(word);
				head = false;
			}
			mark = undefined;
		}
		base += line.length + 1;
		quoteAt = -1;
		quoteEnd = -1;
		mark = undefined;
	}

	return { ranges, heads };
}

export const lisptc = defineLanguage({
	name: "lisptc",
	aliases: ["lisp", "ptc"],
	tokenize: (code) => scan(code).ranges,
});

export const highlighter = createHighlighter({ languages: [lisptc] });

function readsAsProse(
	source: string,
	heads: readonly string[],
	skipped: readonly string[],
): boolean {
	if (looksLikeParenthesizedProse(source)) return true;
	return heads[0] !== undefined && skipped.includes(heads[0]);
}

function proseSpans(text: string, skipped: readonly string[]): FormSpan[] {
	return formSpans(text).filter(([start, end]) => {
		const source = text.slice(start, end);
		return readsAsProse(source, scan(source).heads, skipped);
	});
}

export function tokensIn(text: string, skipped: readonly string[] = []) {
	const { tokens } = highlighter.tokenize(text, { lang: "lisptc" });
	if (skipped.length === 0) return tokens;
	const prose = proseSpans(text, skipped);
	let at = 0;
	return tokens.map((token) => {
		const start = at;
		at += token.value.length;
		return prose.some(([from, to]) => start >= from && at <= to)
			? { value: token.value }
			: token;
	});
}

export function formsIn(text: string, skipped: readonly string[] = []): Forms {
	const heads: string[] = [];
	let prose = "";
	let at = 0;
	for (const [start, end] of formSpans(text)) {
		const source = text.slice(start, end);
		const inner = scan(source).heads;
		if (readsAsProse(source, inner, skipped)) continue;
		prose += text.slice(at, start);
		at = end;
		heads.push(...inner);
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
