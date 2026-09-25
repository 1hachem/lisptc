import {
	appendSym,
	Cell,
	consSym,
	listSym,
	quasiquoteSym,
	quoteSym,
	Sym,
	unquoteSplicingSym,
	unquoteSym,
} from "./objects.ts";

export function qqExpand(x: unknown): unknown {
	return qqExpand0(x, 0);
}

function qqExpand0(x: unknown, level: number): unknown {
	if (x instanceof Cell) {
		if (x.car === unquoteSym) {
			if (level === 0) return (x.cdr as Cell).car;
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

export function qqQuote(x: unknown): unknown {
	if (x instanceof Sym || x instanceof Cell)
		return new Cell(quoteSym, new Cell(x, null));
	return x;
}

function qqExpand1(x: unknown, level: number): Cell {
	if (!(x instanceof Cell)) return new Cell(qqQuote(x), null);
	if (x.car === unquoteSym) {
		if (level === 0) return x.cdr as Cell;
		level--;
	} else if (x.car === quasiquoteSym) {
		level++;
	}
	const h = qqExpand2(x.car, level);
	const t = qqExpand1(x.cdr, level);
	if (t.car === null && t.cdr === null) return new Cell(h, null);
	const merged = qqMerge(h, t.car);
	return merged === undefined ? new Cell(h, t) : new Cell(merged, t.cdr);
}

function qqMerge(h: unknown, tcar: unknown): unknown {
	if (!(h instanceof Cell) || h.car !== listSym) return undefined;
	if (tcar instanceof Cell && tcar.car === listSym)
		return qqConcat(h, tcar.cdr);
	if (h.cdr instanceof Cell) return qqConsCons(h.cdr, tcar);
	return undefined;
}

function qqConcat(x: Cell, y: unknown): unknown {
	if (x === null) return y;
	return new Cell(x.car, qqConcat(x.cdr as Cell, y));
}

function qqConsCons(x: Cell, y: unknown): unknown {
	if (x === null) return y;
	return new Cell(
		consSym,
		new Cell(x.car, new Cell(qqConsCons(x.cdr as Cell, y), null)),
	);
}

function qqExpand2(y: unknown, level: number): unknown {
	if (y instanceof Cell) {
		switch (y.car) {
			case unquoteSym:
				if (level === 0) return new Cell(listSym, y.cdr);
				level--;
				break;
			case unquoteSplicingSym:
				if (level === 0) return (y.cdr as Cell).car;
				level--;
				break;
			case quasiquoteSym:
				level++;
				break;
		}
	}
	return new Cell(listSym, new Cell(qqExpand0(y, level), null));
}
