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
	catchSym,
	type List,
	lambdaSym,
	macroSym,
	mapcar,
	quasiquoteSym,
	quoteSym,
	restSym,
	Sym,
	trySym,
	unquoteSplicingSym,
	unquoteSym,
} from "./objects.ts";
import { qqExpand } from "./quasiquote.ts";

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
	const [hasRest, arity] = makeArgTable(arg.car, table);
	let body = cdrCell(arg);
	body = scanForArgs(body, table) as List;
	body = expandMacros(interp, body, 20) as List;
	body = compileInners(interp, body) as List;
	return make(hasRest ? -arity : arity, body, env);
}

function expandMacros(interp: Compiler, j: unknown, count: number): unknown {
	if (count > 0 && j instanceof Cell) {
		let k = j.car;
		switch (k) {
			case quoteSym:
			case lambdaSym:
			case macroSym:
				return j;
			case quasiquoteSym: {
				const d = cdrCell(j);
				if (d !== null && d.cdr === null) {
					const z = qqExpand(d.car);
					return expandMacros(interp, z, count);
				}
				throw new EvalException("bad quasiquote", j);
			}
			case trySym:
				return expandTry(interp, j, count);
			default:
				if (k instanceof Sym) k = interp.getGlobal(k);
				if (k instanceof Macro) {
					const d = cdrCell(j);
					const z = driveSync(k.expandWith(interp, d));
					return expandMacros(interp, z, count - 1);
				}
				return mapcar(j, (x) => expandMacros(interp, x, count));
		}
	} else {
		return j;
	}
}

function expandTry(interp: Compiler, j: Cell, count: number): unknown {
	const argPart = cdrCell(j);
	const clauseCell = argPart === null ? null : cdrCell(argPart);
	const clause = clauseCell === null ? null : clauseCell.car;
	if (
		argPart === null ||
		clauseCell === null ||
		clauseCell.cdr !== null ||
		!(clause instanceof Cell) ||
		clause.car !== catchSym
	)
		throw new EvalException("bad try", j);
	const bodyForm = expandMacros(interp, argPart.car, count);
	const catchRest = cdrCell(clause);
	if (catchRest === null) throw new EvalException("bad try", j);
	const params = catchRest.car;
	const handlers = mapcar(cdrCell(catchRest), (h) =>
		expandMacros(interp, h, count),
	);
	return new Cell(
		trySym,
		new Cell(
			bodyForm,
			new Cell(new Cell(catchSym, new Cell(params, handlers)), null),
		),
	);
}

function compileInners(interp: Compiler, j: unknown): unknown {
	if (j instanceof Cell) {
		const k = j.car;
		switch (k) {
			case quoteSym:
				return j;
			case lambdaSym: {
				const d = cdrCell(j);
				return compileFunc(interp, d, null, Lambda.make);
			}
			case macroSym:
				throw new EvalException("nested macro", j);
			default:
				return mapcar(j, (x) => compileInners(interp, x));
		}
	} else {
		return j;
	}
}

function variableOf(j: unknown): Sym {
	if (j instanceof Sym) return j;
	if (j instanceof Arg) return j.symbol;
	throw new NotVariableException(j);
}

function makeArgTable(arg: unknown, table: Map<Sym, Arg>): [boolean, number] {
	if (arg === null) return [false, 0];
	if (!(arg instanceof Cell)) throw new EvalException("arglist expected", arg);
	let offset = 0;
	let hasRest = false;
	for (let ag: List = arg; ag !== null; ag = cdrCell(ag)) {
		let j = ag.car;
		if (hasRest) throw new EvalException("2nd rest", j);
		if (j === restSym) {
			ag = cdrCell(ag);
			if (ag === null) throw new NotVariableException(ag);
			j = ag.car;
			if (j === restSym) throw new NotVariableException(j);
			hasRest = true;
		}
		const sym = variableOf(j);
		if (table.has(sym)) throw new EvalException("duplicated argument name", j);
		table.set(sym, new Arg(0, offset, sym));
		offset++;
	}
	return [hasRest, offset];
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
