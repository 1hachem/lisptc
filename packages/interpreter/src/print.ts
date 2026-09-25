import { convertToString, isNumeric } from "./arith.ts";
import {
	Cell,
	type List,
	quasiquoteSym,
	quoteSym,
	Sym,
	unquoteSplicingSym,
	unquoteSym,
} from "./objects.ts";

const quotes: { [key: string]: string } = {
	[quoteSym.name]: "'",
	[quasiquoteSym.name]: "`",
	[unquoteSym.name]: ",",
	[unquoteSplicingSym.name]: ",@",
};

const escapes: { [key: string]: string } = {
	"\b": "\\b",
	"\t": "\\t",
	"\n": "\\n",
	"\v": "\\v",
	"\f": "\\f",
	"\r": "\\r",
	'"': '\\"',
	"\\": "\\\\",
};

function quoted(x: string): string {
	const bf: string[] = ['"'];
	for (const ch of x) bf.push(escapes[ch] ?? ch);
	bf.push('"');
	return bf.join("");
}

function strCell(x: Cell, count?: number, printed?: Cell[]): string {
	const q = x.car instanceof Sym ? quotes[x.car.name] : undefined;
	if (q !== undefined && x.cdr instanceof Cell && x.cdr.cdr == null)
		return q + str(x.cdr.car, true, count, printed);
	return `(${strListBody(x, count, printed)})`;
}

export function str(
	x: unknown,
	quoteString = true,
	count?: number,
	printed?: Cell[],
): string {
	if (x === null) {
		return "nil";
	} else if (x === true) {
		return "t";
	} else if (x instanceof Promise) {
		return "#<promise>";
	} else if (x instanceof Cell) {
		return strCell(x, count, printed);
	} else if (typeof x === "string") {
		return quoteString ? quoted(x) : x;
	} else if (Array.isArray(x)) {
		const s = x.map((e) => str(e, true, count, printed)).join(", ");
		return `[${s}]`;
	} else if (x instanceof Sym) {
		return x.isInterned ? x.name : `#:${x}`;
	} else if (isNumeric(x)) {
		return convertToString(x);
	} else {
		return `${x}`;
	}
}

export function echoText(args: List): string {
	const parts: string[] = [];
	for (let p = args; p !== null; p = p.cdr as List)
		parts.push(str((p as Cell).car, false));
	return parts.join(" ");
}

function strListBody(x: Cell, count?: number, printed?: Cell[]): string {
	if (printed === undefined) printed = [];
	if (count === undefined) count = 4;
	const s: string[] = [];
	let y: unknown;
	for (y = x; y instanceof Cell; y = y.cdr) {
		if (printed.indexOf(y) < 0) {
			printed.push(y);
			count = 4;
		} else {
			count--;
			if (count < 0) {
				s.push("...");
				return s.join(" ");
			}
		}
		s.push(str(y.car, true, count, printed));
	}
	if (y !== null) {
		s.push(".");
		s.push(str(y, true, count, printed));
	}
	for (y = x; y instanceof Cell; y = y.cdr) {
		const i = printed.indexOf(y);
		if (i >= 0) printed.splice(i, 1);
	}
	return s.join(" ");
}
