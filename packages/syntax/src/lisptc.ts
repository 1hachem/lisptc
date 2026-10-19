import { type FormSpan, formSpans } from "@repo/shared/lisp-forms";
import { looksLikeParenthesizedProse } from "@repo/shared/lisp-prose";
import {
	isKeywordToken,
	isQuoteToken,
	numberIn,
	type QuoteToken,
	tokenPattern,
} from "@repo/shared/lisp-tokens";
import {
	createHighlighter,
	defineLanguage,
	type TokenRange,
} from "@tanstack/highlight/core";

const QUOTES: ReadonlySet<QuoteToken> = new Set(["'", "`"]);

interface Scan {
	ranges: TokenRange[];
	heads: string[];
}

export interface Forms {
	prose: string;
	heads: string[];
}

function atomClass(text: string, head: boolean): TokenRange["className"] {
	if (isKeywordToken(text)) return "attr";
	if (numberIn(text) !== null) return "number";
	return head ? "function" : "variable";
}

function proseIn(text: string): FormSpan[] {
	return formSpans(text).filter(([start, end]) =>
		looksLikeParenthesizedProse(text.slice(start, end)),
	);
}

class Scanner {
	readonly ranges: TokenRange[] = [];
	readonly heads: string[] = [];
	private readonly enclosing: boolean[] = [];
	private depth = 0;
	private head = false;
	private quoted = false;
	private mark: "quote" | "unquote" | undefined;
	private quasi = false;
	private template = false;
	private quoteAt = -1;
	private quoteEnd = -1;

	constructor(private readonly prose: readonly FormSpan[]) {}

	get atTop() {
		return this.depth === 0;
	}

	push(start: number, end: number, className: TokenRange["className"]) {
		if (this.depth > 0 && !within(this.prose, start, end))
			this.ranges.push({ className, start, end });
	}

	quote(word: QuoteToken, start: number, end: number) {
		if (this.depth > 0) this.push(start, end, "operator");
		else if (this.quoteEnd !== start) this.quoteAt = start;
		this.quoteEnd = end;
		this.mark = QUOTES.has(word) ? "quote" : "unquote";
		this.quasi = word === "`";
	}

	takeFrom(start: number) {
		const from =
			this.quoteEnd === start && this.quoteAt >= 0 ? this.quoteAt : start;
		this.quoteAt = -1;
		this.quoteEnd = -1;
		return from;
	}

	open(from: number, end: number) {
		this.template = this.depth === 0 && this.quasi;
		this.enclosing.push(this.quoted);
		if (this.mark !== undefined) this.quoted = this.mark === "quote";
		this.depth += 1;
		this.head = true;
		this.push(from, end, "operator");
	}

	close(start: number, end: number) {
		this.push(start, end, "operator");
		if (this.depth > 0) {
			this.depth -= 1;
			this.quoted = this.enclosing.pop() ?? false;
		}
		this.head = false;
	}

	string(start: number, end: number) {
		this.push(start, end, "string");
		this.head = false;
	}

	atom(word: string, start: number, end: number) {
		this.push(start, end, atomClass(word, this.head && !this.quoted));
		if (this.names(word) && !within(this.prose, start, end))
			this.heads.push(word);
		this.head = false;
	}

	private names(word: string) {
		if (!this.head) return false;
		if (!this.quoted) return !isKeywordToken(word);
		return this.template && atomClass(word, true) === "function";
	}

	endToken() {
		this.mark = undefined;
		this.quasi = false;
	}

	endLine() {
		this.quoteAt = -1;
		this.quoteEnd = -1;
		this.endToken();
	}
}

type Next = number | "rest-of-line" | undefined;

function stringWord(
	scanner: Scanner,
	word: string,
	start: number,
	lineEnd: number,
): Next {
	if (scanner.atTop) {
		const paren = word.indexOf("(", 1);
		return paren >= 0 ? paren : undefined;
	}
	if (word === '"') {
		scanner.push(start, lineEnd, "string");
		return "rest-of-line";
	}
	scanner.string(start, start + word.length);
	return undefined;
}

function scanWord(
	scanner: Scanner,
	word: string,
	start: number,
	lineEnd: number,
): Next {
	const end = start + word.length;
	if (isQuoteToken(word)) {
		scanner.quote(word, start, end);
		return undefined;
	}
	const from = scanner.takeFrom(start);
	let next: Next;
	if (word === "(") scanner.open(from, end);
	else if (word === ")") scanner.close(start, end);
	else if (word.startsWith('"'))
		next = stringWord(scanner, word, start, lineEnd);
	else scanner.atom(word, start, end);
	scanner.endToken();
	return next;
}

function scanLine(scanner: Scanner, token: RegExp, line: string, base: number) {
	for (let m = token.exec(line); m !== null; m = token.exec(line)) {
		const word = m[1];
		if (word === undefined) continue;
		const next = scanWord(scanner, word, base + m.index, base + line.length);
		if (next === "rest-of-line") {
			token.lastIndex = 0;
			return;
		}
		if (next !== undefined) token.lastIndex = m.index + next;
	}
}

function scan(text: string, prose: readonly FormSpan[]): Scan {
	const token = tokenPattern();
	const scanner = new Scanner(prose);
	let base = 0;
	for (const line of text.split("\n")) {
		scanLine(scanner, token, line, base);
		base += line.length + 1;
		scanner.endLine();
	}
	return { ranges: scanner.ranges, heads: scanner.heads };
}

export const lisptc = defineLanguage({
	name: "lisptc",
	aliases: ["lisp", "ptc"],
	tokenize: (code) => scan(code, proseIn(code)).ranges,
});

const lisptcSource = defineLanguage({
	name: "lisptc-source",
	tokenize: (code) => scan(code, []).ranges,
});

export const highlighter = createHighlighter({
	languages: [lisptc, lisptcSource],
});

function within(
	skipped: readonly FormSpan[],
	start: number,
	end: number,
): boolean {
	return skipped.some(([from, to]) => start >= from && end <= to);
}

export function tokensIn(text: string, skipped: readonly FormSpan[] = []) {
	const { tokens } = highlighter.tokenize(text, { lang: "lisptc" });
	if (skipped.length === 0) return tokens;
	let at = 0;
	return tokens.map((token) => {
		const start = at;
		at += token.value.length;
		return within(skipped, start, at) ? { value: token.value } : token;
	});
}

export function sourceTokensIn(text: string) {
	return highlighter.tokenize(text, { lang: "lisptc-source" }).tokens;
}

export function formsIn(
	text: string,
	skipped: readonly FormSpan[] = [],
): Forms {
	const heads: string[] = [];
	let prose = "";
	let at = 0;
	for (const [start, end] of formSpans(text)) {
		const source = text.slice(start, end);
		if (within(skipped, start, end) || looksLikeParenthesizedProse(source))
			continue;
		prose += text.slice(at, start);
		at = end;
		heads.push(...scan(source, proseIn(source)).heads);
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
