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
	private readonly token = tokenPattern();
	private readonly enclosing: boolean[] = [];
	private depth = 0;
	private head = false;
	private quoted = false;
	private mark: "quote" | "unquote" | undefined;
	private base = 0;
	private quoteAt = -1;
	private quoteEnd = -1;

	constructor(private readonly prose: readonly FormSpan[]) {}

	scan(text: string): Scan {
		for (const line of text.split("\n")) {
			this.line(line);
			this.base += line.length + 1;
			this.quoteAt = -1;
			this.quoteEnd = -1;
			this.mark = undefined;
		}
		return { ranges: this.ranges, heads: this.heads };
	}

	private line(line: string): void {
		const token = this.token;
		for (let m = token.exec(line); m !== null; m = token.exec(line)) {
			const word = m[1];
			if (word === undefined) continue;
			const start = this.base + m.index;
			if (isQuoteToken(word)) {
				this.quote(word, start);
				continue;
			}
			const from =
				this.quoteEnd === start && this.quoteAt >= 0 ? this.quoteAt : start;
			this.quoteAt = -1;
			this.quoteEnd = -1;
			if (word.startsWith('"')) {
				if (this.string(word, line, m.index)) return;
			} else this.atom(word, from, start);
			this.mark = undefined;
		}
	}

	private push(start: number, end: number, className: TokenRange["className"]) {
		if (this.depth > 0 && !within(this.prose, start, end))
			this.ranges.push({ className, start, end });
	}

	private quote(word: QuoteToken, start: number): void {
		const end = start + word.length;
		if (this.depth > 0) this.push(start, end, "operator");
		else if (this.quoteEnd !== start) this.quoteAt = start;
		this.quoteEnd = end;
		this.mark = QUOTES.has(word) ? "quote" : "unquote";
	}

	private string(word: string, line: string, index: number): boolean {
		const start = this.base + index;
		if (this.depth === 0) {
			const paren = word.indexOf("(", 1);
			if (paren >= 0) this.token.lastIndex = index + paren;
			return false;
		}
		if (word === '"') {
			this.push(start, this.base + line.length, "string");
			this.token.lastIndex = 0;
			return true;
		}
		this.push(start, start + word.length, "string");
		this.head = false;
		return false;
	}

	private atom(word: string, from: number, start: number): void {
		const end = start + word.length;
		if (word === "(") this.open(from, end);
		else if (word === ")") this.close(start, end);
		else this.symbol(word, start, end);
	}

	private open(from: number, end: number): void {
		this.enclosing.push(this.quoted);
		if (this.mark !== undefined) this.quoted = this.mark === "quote";
		this.depth += 1;
		this.head = true;
		this.push(from, end, "operator");
	}

	private close(start: number, end: number): void {
		this.push(start, end, "operator");
		if (this.depth > 0) {
			this.depth -= 1;
			this.quoted = this.enclosing.pop() ?? false;
		}
		this.head = false;
	}

	private symbol(word: string, start: number, end: number): void {
		const head = this.head && !this.quoted;
		this.push(start, end, atomClass(word, head));
		if (head && !isKeywordToken(word) && !within(this.prose, start, end))
			this.heads.push(word);
		this.head = false;
	}
}

function scan(text: string, prose: readonly FormSpan[]): Scan {
	return new Scanner(prose).scan(text);
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
	guessesProse = true,
): Forms {
	const heads: string[] = [];
	let prose = "";
	let at = 0;
	for (const [start, end] of formSpans(text)) {
		const source = text.slice(start, end);
		if (
			within(skipped, start, end) ||
			(guessesProse && looksLikeParenthesizedProse(source))
		)
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
