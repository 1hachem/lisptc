import { tokenPattern } from "@repo/shared/lisp-tokens";
import { tryToParse } from "./arith.ts";
import { EvalException } from "./errors.ts";
import {
	backQuoteSym,
	Cell,
	commaAtSym,
	commaSym,
	dotSym,
	EndOfFile,
	leftParenSym,
	newLispKeyword,
	newSym,
	quasiquoteSym,
	quoteSym,
	rightParenSym,
	singleQuoteSym,
	unquoteSplicingSym,
	unquoteSym,
} from "./objects.ts";

class FormatException extends Error {}

class SyntaxException extends EvalException {
	constructor(
		readonly reason: string,
		readonly line: number,
	) {
		super("syntax error", `${reason} at ${line}`, false);
	}
}

export interface SyntaxFailure {
	reason: string;
	line: number;
}

export function readFailure(source: string): SyntaxFailure | undefined {
	const reader = new Reader();
	reader.push(source);
	try {
		while (!reader.isEmpty()) reader.read();
	} catch (ex) {
		if (ex === EndOfFile)
			return { reason: "unexpected end of input", line: reader.line };
		if (ex instanceof SyntaxException)
			return { reason: ex.reason, line: ex.line };
	}
	return undefined;
}

export class Reader {
	private token: unknown;
	private tokens: string[] = [];
	private lineNo = 1;

	push(text: string): void {
		const tokenPat = tokenPattern();
		for (const line of text.split("\n")) {
			for (;;) {
				const result = tokenPat.exec(line);
				if (result === null) break;
				const s = result[1];
				if (s !== undefined) this.tokens.push(s);
			}
			this.tokens.push("\n");
		}
	}

	get line(): number {
		return this.lineNo;
	}

	isEmpty(): boolean {
		return this.tokens.every((t: string) => t === "\n");
	}

	read(): unknown {
		try {
			this.readToken();
			return this.parseExpression();
		} catch (ex) {
			if (ex === EndOfFile) throw EndOfFile;
			else if (ex instanceof FormatException)
				throw new SyntaxException(ex.message, this.lineNo);
			else throw ex;
		}
	}

	private parseExpression(): unknown {
		switch (this.token) {
			case leftParenSym:
				this.readToken();
				return this.parseListBody();
			case singleQuoteSym:
				this.readToken();
				return new Cell(quoteSym, new Cell(this.parseExpression(), null));
			case backQuoteSym:
				this.readToken();
				return new Cell(quasiquoteSym, new Cell(this.parseExpression(), null));
			case commaSym:
				this.readToken();
				return new Cell(unquoteSym, new Cell(this.parseExpression(), null));
			case commaAtSym:
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

	private readToken(): void {
		for (;;) {
			const t = this.tokens.shift();
			if (t === undefined) {
				throw EndOfFile;
			} else if (t === "\n") {
				this.lineNo += 1;
			} else if (t === "+" || t === "-") {
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
					this.token = newLispKeyword(t.slice(1));
				else if (t.startsWith("#<"))
					throw new EvalException(
						"a #<…> form is a printed handle, not something that can be read back; use the name the REPL reported the value under",
						t,
						false,
					);
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
