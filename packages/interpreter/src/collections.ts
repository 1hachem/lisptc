import { Cell, LispKeyword, Sym } from "./objects.ts";

export class LispVector {
	constructor(readonly items: unknown[]) {}
}

function hashKey(x: unknown): unknown {
	if (typeof x === "string") return `s${x}`;
	if (typeof x === "bigint") return `n${x}`;
	if (typeof x === "number")
		return Number.isInteger(x) ? `n${BigInt(x)}` : `f${x}`;
	if (x instanceof Cell) return `c${structuralKey(x)}`;
	return x;
}

function structuralKey(x: unknown): string {
	if (x === null) return "()";
	if (x === true) return "t";
	if (x instanceof Cell)
		return `(${structuralKey(x.car)} . ${structuralKey(x.cdr)})`;
	if (x instanceof LispKeyword) return `:${x.name}`;
	if (x instanceof Sym) return `'${x.name}`;
	const key = hashKey(x);
	return typeof key === "string" ? JSON.stringify(key) : "#<object>";
}

export class LispHashTable {
	private readonly entries = new Map<unknown, [unknown, unknown]>();

	get size(): number {
		return this.entries.size;
	}

	get(key: unknown): [unknown, unknown] | undefined {
		return this.entries.get(hashKey(key));
	}

	set(key: unknown, value: unknown): void {
		this.entries.set(hashKey(key), [key, value]);
	}

	delete(key: unknown): boolean {
		return this.entries.delete(hashKey(key));
	}

	clear(): void {
		this.entries.clear();
	}

	pairs(): [unknown, unknown][] {
		return [...this.entries.values()];
	}
}
