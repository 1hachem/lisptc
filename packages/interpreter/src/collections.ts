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

function copyTree(x: unknown): unknown {
	return x instanceof Cell ? new Cell(copyTree(x.car), copyTree(x.cdr)) : x;
}

export class LispHashTable {
	constructor(
		private readonly entries = new Map<unknown, [unknown, unknown]>(),
		readonly writable = true,
	) {}

	private view: LispHashTable | undefined;

	readOnly(): LispHashTable {
		if (!this.writable) return this;
		this.view ??= new LispHashTable(this.entries, false);
		return this.view;
	}

	private handed(value: unknown): unknown {
		return this.writable ? value : copyTree(value);
	}

	get size(): number {
		return this.entries.size;
	}

	get(key: unknown): [unknown, unknown] | undefined {
		const hit = this.entries.get(hashKey(key));
		return hit === undefined
			? undefined
			: [this.handed(hit[0]), this.handed(hit[1])];
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
		return [...this.entries.values()].map(([key, value]) => [
			this.handed(key),
			this.handed(value),
		]);
	}
}
