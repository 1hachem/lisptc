/*
 * Compilation helpers: argument-table construction, bound-variable scanning
 * and quasi-quotation expansion.
 */
import { EvalException, NotVariableException } from "./exceptions.ts";
import { Arg } from "./func.ts";
import {
	appendSym,
	Cell,
	cdrCell,
	consSym,
	type List,
	listSym,
	mapList,
	quasiquoteSym,
	quoteSym,
	restSym,
	Sym,
	unquoteSplicingSym,
	unquoteSym,
} from "./sexpr.ts";

// Make an argument table; return a pair of rest-yes/no and the arity.
export function makeArgTable(
	arg: unknown,
	table: Map<Sym, Arg>,
): [boolean, number] {
	if (arg === null) {
		return [false, 0];
	} else if (arg instanceof Cell) {
		let ag = arg as List;
		let offset = 0; // offset value within the call-frame
		let hasRest = false;
		for (; ag !== null; ag = cdrCell(ag)) {
			let j = ag.car;
			if (hasRest) throw new EvalException("2nd rest", j);
			if (j === restSym) {
				// &rest var
				ag = cdrCell(ag);
				if (ag === null) throw new NotVariableException(ag);
				j = ag.car;
				if (j === restSym) throw new NotVariableException(j);
				hasRest = true;
			}
			let sym: Sym;
			if (j instanceof Sym) sym = j;
			else if (j instanceof Arg) sym = j.symbol;
			else throw new NotVariableException(j);
			if (table.has(sym))
				throw new EvalException("duplicated argument name", j);
			table.set(sym, new Arg(0, offset, sym));
			offset++;
		}
		return [hasRest, offset];
	} else {
		throw new EvalException("arglist expected", arg);
	}
}

// Scan 'j' for formal arguments in 'table' and replace them with Args.
// And scan 'j' for free Args not in 'table' and promote their levels.
export function scanForArgs(j: unknown, table: Map<Sym, Arg>): unknown {
	if (j instanceof Sym) {
		const k = table.get(j);
		return k === undefined ? j : k;
	} else if (j instanceof Arg) {
		const k = table.get(j.symbol);
		return k === undefined ? new Arg(j.level + 1, j.offset, j.symbol) : k;
	} else if (j instanceof Cell) {
		if (j.car === quoteSym) {
			return j;
		} else if (j.car === quasiquoteSym) {
			return new Cell(quasiquoteSym, scanForQQ(j.cdr, table, 0));
		} else {
			return mapList(j, (x) => scanForArgs(x, table));
		}
	} else {
		return j;
	}
}

// Scan for quasi-quotes and scanForArgs them depending on the nesting level.
function scanForQQ(j: unknown, table: Map<Sym, Arg>, level: number): unknown {
	if (j instanceof Cell) {
		const k = j.car;
		if (k === quasiquoteSym) {
			return new Cell(k, scanForQQ(j.cdr, table, level + 1));
		} else if (k === unquoteSym || k === unquoteSplicingSym) {
			const d =
				level === 0
					? scanForArgs(j.cdr, table)
					: scanForQQ(j.cdr, table, level - 1);
			if (Object.is(d, j.cdr)) return j;
			return new Cell(k, d);
		} else {
			return mapList(j, (x) => scanForQQ(x, table, level));
		}
	} else {
		return j;
	}
}

//----------------------------------------------------------------------
// Quasi-Quotation

// Expand x of any quasi-quotation `x into the equivalent S-expression.
export function qqExpand(x: unknown): unknown {
	return qqExpand0(x, 0); // Begin with the nesting level 0.
}

function qqExpand0(x: unknown, level: number): unknown {
	if (x instanceof Cell) {
		if (x.car === unquoteSym) {
			// ,a
			if (level === 0) return (x.cdr as Cell).car; // ,a => a
		}
		const t = qqExpand1(x, level);
		if (t.car instanceof Cell && t.cdr === null) {
			const k = t.car;
			if (k.car === listSym || k.car === consSym) return k;
		}
		return new Cell(appendSym, t);
	} else {
		return qqQuote(x);
	}
}

// Quote x so that the result evaluates to x.
export function qqQuote(x: unknown): unknown {
	if (x instanceof Sym || x instanceof Cell)
		return new Cell(quoteSym, new Cell(x, null));
	return x;
}

// Expand x of `x so that the result can be used as an argument of append.
// Example 1: (,a b) => ((list a 'b))
// Example 2: (,a ,@(cons 2 3)) => ((cons a (cons 2 3)))
function qqExpand1(x: unknown, level: number): Cell {
	if (x instanceof Cell) {
		if (x.car === unquoteSym) {
			// ,a
			if (level === 0) return x.cdr as Cell; // ,a => (a)
			level--;
		} else if (x.car === quasiquoteSym) {
			// `a
			level++;
		}
		const h = qqExpand2(x.car, level);
		const t = qqExpand1(x.cdr, level); // !== null
		if (t.car === null && t.cdr === null) {
			return new Cell(h, null);
		} else if (h instanceof Cell) {
			if (h.car === listSym) {
				const tcar = t.car;
				if (tcar instanceof Cell) {
					if (tcar.car === listSym) {
						const hh = qqConcat(h, tcar.cdr);
						return new Cell(hh, t.cdr);
					}
				}
				if (h.cdr instanceof Cell) {
					const hh = qqConsCons(h.cdr, tcar);
					return new Cell(hh, t.cdr);
				}
			}
		}
		return new Cell(h, t);
	} else {
		return new Cell(qqQuote(x), null);
	}
}

// (1 2), (3 4) => (1 2 3 4)
function qqConcat(x: Cell, y: unknown): unknown {
	if (x === null) return y;
	return new Cell(x.car, qqConcat(x.cdr as Cell, y));
}

// (1 2 3), "a" => (cons 1 (cons 2 (cons 3 "a")))
function qqConsCons(x: Cell, y: unknown): unknown {
	if (x === null) return y;
	return new Cell(
		consSym,
		new Cell(x.car, new Cell(qqConsCons(x.cdr as Cell, y), null)),
	);
}

// Expand x.car (=y) of `x so that the result can be used as an arg of append.
// Example: ,a => (list a); ,@(foo 1 2) => (foo 1 2); b => (list 'b)
function qqExpand2(y: unknown, level: number): unknown {
	if (y instanceof Cell) {
		switch (y.car) {
			case unquoteSym: // ,a
				if (level === 0) return new Cell(listSym, y.cdr); // ,a => (list a)
				level--;
				break;
			case unquoteSplicingSym: // ,@a
				if (level === 0) return (y.cdr as Cell).car; // ,@a => a
				level--;
				break;
			case quasiquoteSym: // `a
				level++;
				break;
		}
	}
	return new Cell(listSym, new Cell(qqExpand0(y, level), null));
}
