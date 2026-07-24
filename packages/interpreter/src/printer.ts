/*
 * The printer: string representations of Lisp values.
 */
import { convertToString, isNumeric } from "./arith.ts";
import { Cell, Sym } from "./sexpr.ts";

// Mapping from a quote symbol's name to its shorthand representation.
const quotes: { [key: string]: string } = {
	quote: "'",
	quasiquote: "`",
	unquote: ",",
	"unquote-splicing": ",@",
};

// How many re-visited cells to print before eliding a circular list.
const CIRCULAR_GRACE = 4;

// Make a string representation of Lisp expression
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
	} else if (x instanceof Cell) {
		if (x.car instanceof Sym) {
			const q = quotes[x.car.name];
			if (q !== undefined && x.cdr instanceof Cell)
				if (x.cdr.cdr == null) return q + str(x.cdr.car, true, count, printed);
		}
		return `(${strListBody(x, count, printed)})`;
	} else if (typeof x === "string") {
		if (!quoteString) return x;
		const bf: string[] = ['"'];
		for (const ch of x) {
			switch (ch) {
				case "\b":
					bf.push("\\b");
					break;
				case "\t":
					bf.push("\\t");
					break;
				case "\n":
					bf.push("\\n");
					break;
				case "\v":
					bf.push("\\v");
					break;
				case "\f":
					bf.push("\\f");
					break;
				case "\r":
					bf.push("\\r");
					break;
				case '"':
					bf.push('\\"');
					break;
				case "\\":
					bf.push("\\\\");
					break;
				default:
					bf.push(ch);
					break;
			}
		}
		bf.push('"');
		return bf.join("");
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

// Make a string representation of list, omitting its "(" and ")".
function strListBody(x: Cell, count?: number, printed?: Cell[]): string {
	if (printed === undefined) printed = [];
	if (count === undefined) count = CIRCULAR_GRACE;
	const s: string[] = [];
	let y: unknown;
	for (y = x; y instanceof Cell; y = y.cdr) {
		if (printed.indexOf(y) < 0) {
			printed.push(y);
			count = CIRCULAR_GRACE;
		} else {
			count--;
			if (count < 0) {
				s.push("..."); // an ellipsis for a circular list
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
