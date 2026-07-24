/*
 * The reader: tokenizing Lisp source text and parsing it into S-expressions.
 */
import { tryToParse } from "./arith.ts";
import { EndOfFile, EvalException, FormatException } from "./exceptions.ts";
import { write } from "./io.ts";
import {
	backQuoteSym,
	Cell,
	commaAtSym,
	commaSym,
	dotSym,
	leftParenSym,
	newLispKeyword,
	newSym,
	quasiquoteSym,
	quoteSym,
	rightParenSym,
	singleQuoteSym,
	unquoteSplicingSym,
	unquoteSym,
} from "./sexpr.ts";

// One token per match: whitespace and ;-comments are skipped (group 0 only),
// while group 1 captures a string literal ("..." with escapes), ",@" / ",",
// a run of ordinary atom characters, or any single remaining character
// (parens, quotes, backquote...).
const TOKEN_PATTERN = /\s+|;.*$|("(\\.?|.)*?"|,@?|[^()'`~"; \t]+|.)/g;

// A list of tokens, which works as a reader of Lisp expressions
export class Reader {
	private token: unknown;
	private tokens: string[] = [];
	private lineNo = 1;

	// Split a text into a list of tokens and append it to this.tokens.
	// For "(a \n 1)" it appends ["(", "a", "\n", "1", ")", "\n"] to tokens.
	push(text: string): void {
		const tokenPat = new RegExp(TOKEN_PATTERN.source, "g");
		for (const line of text.split("\n")) {
			for (;;) {
				const result = tokenPat.exec(line);
				if (result === null) break;
				const s = result[1];
				if (s !== undefined) this.tokens.push(s);
				else if (result[0].startsWith(";"))
					write(`Warning: comments are not allowed; ignored: ${result[0]}\n`);
			}
			this.tokens.push("\n");
		}
	}

	// 1-based line number of the token last consumed.
	get line(): number {
		return this.lineNo;
	}

	// Make this be a clone of the other.
	copyFrom(other: Reader): void {
		this.tokens = other.tokens.slice();
		this.lineNo = other.lineNo;
	}

	// Make this have no tokens.
	clear(): void {
		this.tokens.length = 0;
	}

	// Does this have no tokens?
	isEmpty(): boolean {
		return this.tokens.every((t: string) => t === "\n");
	}

	// Read a Lisp expression; throw EndOfFile if this.tokens run out.
	read(): unknown {
		try {
			this.readToken();
			return this.parseExpression();
		} catch (ex) {
			if (ex === EndOfFile) throw EndOfFile;
			else if (ex instanceof FormatException)
				throw new EvalException(
					"syntax error",
					`${ex.message} at ${this.lineNo}`,
					false,
				);
			else throw ex;
		}
	}

	private parseExpression(): unknown {
		switch (this.token) {
			case leftParenSym: // (a b c)
				this.readToken();
				return this.parseListBody();
			case singleQuoteSym: // 'a => (quote a)
				this.readToken();
				return new Cell(quoteSym, new Cell(this.parseExpression(), null));
			case backQuoteSym: // `a => (quasiquote a)
				this.readToken();
				return new Cell(quasiquoteSym, new Cell(this.parseExpression(), null));
			case commaSym: // ,a => (unquote a)
				this.readToken();
				return new Cell(unquoteSym, new Cell(this.parseExpression(), null));
			case commaAtSym: // ,@a => (unquote-splicing a)
				this.readToken();
				return new Cell(
					unquoteSplicingSym,
					new Cell(this.parseExpression(), null),
				);
			case dotSym:
			case rightParenSym:
				throw new FormatException(`unexpected "${this.token}"`);
			default:
				return this.token;
		}
	}

	private parseListBody(): unknown {
		if (this.token === rightParenSym) {
			return null;
		} else {
			const e1 = this.parseExpression();
			this.readToken();
			let e2: unknown;
			if (this.token === dotSym) {
				// (a . b)
				this.readToken();
				e2 = this.parseExpression();
				this.readToken();
				if (this.token !== rightParenSym)
					throw new FormatException(`")" expected: ${this.token}`);
			} else {
				e2 = this.parseListBody();
			}
			return new Cell(e1, e2);
		}
	}

	// Read the next token and set it to this.token.
	private readToken(): void {
		for (;;) {
			const t = this.tokens.shift();
			if (t === undefined) {
				throw EndOfFile;
			} else if (t === "\n") {
				this.lineNo += 1;
			} else if (t === "+" || t === "-") {
				// N.B. BigInt("+") and BigInt("-") return 0n in Safari.
				this.token = newSym(t);
				return;
			} else {
				if (t[0] === '"') {
					let s = t;
					const n = s.length - 1;
					if (n < 1 || s[n] !== '"')
						throw new FormatException(`bad string: ${s}`);
					s = s.substring(1, n);
					s = s.replace(/\\./g, (m: string) => {
						const val = Reader.escapes[m];
						return val === undefined ? m : val;
					});
					this.token = s;
					return;
				}
				const n = tryToParse(t);
				if (n !== null) this.token = n;
				else if (t === "nil") this.token = null;
				else if (t === "t") this.token = true;
				else if (t.length > 1 && t[0] === ":")
					// Self-evaluating keyword literal, e.g. :query
					this.token = newLispKeyword(t.slice(1));
				else this.token = newSym(t);
				return;
			}
		}
	}

	private static escapes: { [key: string]: string } = {
		"\\\\": "\\",
		'\\"': '"',
		"\\n": "\n",
		"\\r": "\r",
		"\\f": "\f",
		"\\b": "\b",
		"\\t": "\t",
		"\\v": "\v",
	};
}
