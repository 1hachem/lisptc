import { driveSync, type Evaluator } from "./drive.ts";
import { cdrCell, EvalException, NotVariableException } from "./errors.ts";
import {
	Arg,
	type DefinedFunc,
	type FuncFactory,
	Lambda,
	Macro,
} from "./func.ts";
import {
	Cell,
	keySym,
	type List,
	lambdaSym,
	macroSym,
	mapcar,
	quasiquoteSym,
	quoteSym,
	restSym,
	Sym,
	unquoteSplicingSym,
	unquoteSym,
} from "./objects.ts";

export interface Compiler extends Evaluator {
	getGlobal(sym: Sym): unknown;
}

export function compileFunc(
	interp: Compiler,
	arg: List,
	env: List,
	make: FuncFactory,
): DefinedFunc {
	if (arg === null) throw new EvalException("arglist and body expected", arg);
	const table = new Map<Sym, Arg>();
	const { hasRest, arity, keys } = makeArgTable(arg.car, table);
	let body = cdrCell(arg);
	body = scanForArgs(body, table) as List;
	body = compileForm(interp, body, 20) as List;
	return make(hasRest ? -arity : arity, body, env, keys);
}

function compileForm(interp: Compiler, j: unknown, depth: number): unknown {
	if (!(j instanceof Cell)) return j;
	switch (j.car) {
		case quoteSym:
			return j;
		case lambdaSym:
			return compileFunc(interp, cdrCell(j), null, Lambda.make);
		case macroSym:
			throw new EvalException("nested macro", j);
	}
	const head = j.car instanceof Sym ? interp.getGlobal(j.car) : j.car;
	if (head instanceof Macro && depth > 0) {
		const expansion = driveSync(head.expandWith(interp, cdrCell(j)));
		return compileForm(interp, expansion, depth - 1);
	}
	return mapcar(j, (x) => compileForm(interp, x, depth));
}

function variableOf(j: unknown): Sym {
	if (j instanceof Sym) return j;
	if (j instanceof Arg) return j.symbol;
	throw new NotVariableException(j);
}

interface ArgTable {
	hasRest: boolean;
	arity: number;
	keys: string[];
}

function afterRest(ag: Cell): Cell {
	const next = cdrCell(ag);
	if (next === null) throw new NotVariableException(next);
	if (next.car === restSym) throw new NotVariableException(next.car);
	return next;
}

function addArg(table: Map<Sym, Arg>, j: unknown, offset: number): Sym {
	const sym = variableOf(j);
	if (table.has(sym)) throw new EvalException("duplicated argument name", j);
	table.set(sym, new Arg(0, offset, sym));
	return sym;
}

function makeArgTable(arg: unknown, table: Map<Sym, Arg>): ArgTable {
	if (arg === null) return { hasRest: false, arity: 0, keys: [] };
	if (!(arg instanceof Cell)) throw new EvalException("arglist expected", arg);
	let offset = 0;
	let hasRest = false;
	let keyed = false;
	const keys: string[] = [];
	for (let ag: List = arg; ag !== null; ag = cdrCell(ag)) {
		if (hasRest) throw new EvalException("2nd rest", ag.car);
		if (ag.car === keySym) {
			if (keyed) throw new EvalException("2nd &key", ag.car);
			keyed = true;
			continue;
		}
		if (ag.car === restSym) {
			if (keyed) throw new EvalException("&rest after &key", ag.car);
			ag = afterRest(ag);
			hasRest = true;
		}
		const sym = addArg(table, ag.car, offset);
		if (keyed) keys.push(sym.name);
		offset++;
	}
	if (keyed && keys.length === 0)
		throw new EvalException("&key with nothing after it", arg);
	return { hasRest, arity: offset, keys };
}

function scanForArgs(j: unknown, table: Map<Sym, Arg>): unknown {
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
			return mapcar(j, (x) => scanForArgs(x, table));
		}
	} else {
		return j;
	}
}

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
			return mapcar(j, (x) => scanForQQ(x, table, level));
		}
	} else {
		return j;
	}
}
