import { Cell, LispKeyword, newSym, Sym } from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";

export class Var {
	ref: unknown = undefined;
	constructor(readonly name: string) {}
}

export class Trail {
	private readonly bound: Var[] = [];

	get mark(): number {
		return this.bound.length;
	}

	bind(v: Var, value: unknown): void {
		v.ref = value;
		this.bound.push(v);
	}

	undo(mark: number): void {
		while (this.bound.length > mark) {
			const v = this.bound.pop();
			if (v !== undefined) v.ref = undefined;
		}
	}
}

export function isVarSym(x: unknown): x is Sym {
	return x instanceof Sym && x.name.length > 1 && x.name[0] === "?";
}

export function isAnonymous(x: Sym): boolean {
	return x.name === "?_";
}

export function walk(x: unknown): unknown {
	let t = x;
	while (t instanceof Var && t.ref !== undefined) t = t.ref;
	return t;
}

export function resolve(x: unknown): unknown {
	const t = walk(x);
	if (t instanceof Cell) return new Cell(resolve(t.car), resolve(t.cdr));
	return t;
}

export function reify(x: unknown): unknown {
	const t = walk(x);
	if (t instanceof Var) return newSym(t.name);
	if (t instanceof Cell) return new Cell(reify(t.car), reify(t.cdr));
	return t;
}

export function instantiate(x: unknown, vars: Map<string, Var>): unknown {
	if (isVarSym(x)) {
		if (isAnonymous(x)) return new Var("?_");
		let v = vars.get(x.name);
		if (v === undefined) {
			v = new Var(x.name);
			vars.set(x.name, v);
		}
		return v;
	}
	if (x instanceof Cell)
		return new Cell(instantiate(x.car, vars), instantiate(x.cdr, vars));
	return x;
}

function sameAtom(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a instanceof LispKeyword && b instanceof LispKeyword)
		return a.name === b.name;
	if (
		(typeof a === "bigint" || typeof a === "number") &&
		(typeof b === "bigint" || typeof b === "number")
	)
		return Number(a) === Number(b);
	return false;
}

function occurs(v: Var, x: unknown): boolean {
	const t = walk(x);
	if (t === v) return true;
	if (t instanceof Cell) return occurs(v, t.car) || occurs(v, t.cdr);
	return false;
}

export function unify(a: unknown, b: unknown, trail: Trail): boolean {
	const stack: [unknown, unknown][] = [[a, b]];
	while (stack.length > 0) {
		const pair = stack.pop();
		if (pair === undefined) break;
		const x = walk(pair[0]);
		const y = walk(pair[1]);
		if (x === y) continue;
		if (x instanceof Var) {
			if (occurs(x, y)) return false;
			trail.bind(x, y);
			continue;
		}
		if (y instanceof Var) {
			if (occurs(y, x)) return false;
			trail.bind(y, x);
			continue;
		}
		if (x instanceof Cell && y instanceof Cell) {
			stack.push([x.cdr, y.cdr], [x.car, y.car]);
			continue;
		}
		if (!sameAtom(x, y)) return false;
	}
	return true;
}

export function isGround(x: unknown): boolean {
	const t = walk(x);
	if (t instanceof Var || isVarSym(t)) return false;
	if (t instanceof Cell) return isGround(t.car) && isGround(t.cdr);
	return true;
}

export function functorOf(term: unknown): string | undefined {
	const t = walk(term);
	if (t instanceof Sym) return `${t.name}/0`;
	if (!(t instanceof Cell)) return undefined;
	const head = walk(t.car);
	if (!(head instanceof Sym)) return undefined;
	let arity = 0;
	for (let rest = walk(t.cdr); rest instanceof Cell; rest = walk(rest.cdr))
		arity++;
	return `${head.name}/${arity}`;
}

export function argsOf(term: unknown): unknown[] {
	const t = walk(term);
	const out: unknown[] = [];
	if (!(t instanceof Cell)) return out;
	for (let rest = walk(t.cdr); rest instanceof Cell; rest = walk(rest.cdr))
		out.push(rest.car);
	return out;
}

export function variant(x: unknown): string {
	const names = new Map<unknown, string>();
	const rename = (t: unknown): unknown => {
		const w = walk(t);
		if (w instanceof Var || isVarSym(w)) {
			const key = w instanceof Var ? w : w.name;
			const label = names.get(key) ?? `?${names.size}`;
			names.set(key, label);
			return newSym(label);
		}
		if (w instanceof Cell) return new Cell(rename(w.car), rename(w.cdr));
		return w;
	};
	return str(rename(x));
}

export function varSymsOf(x: unknown, into: Sym[] = []): Sym[] {
	if (isVarSym(x)) {
		if (!isAnonymous(x) && !into.includes(x)) into.push(x);
	} else if (x instanceof Cell) {
		varSymsOf(x.car, into);
		varSymsOf(x.cdr, into);
	}
	return into;
}

export function shortHash(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}
