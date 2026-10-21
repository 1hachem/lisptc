import type { Arity, Doc, DocArg } from "@repo/interpreter/docs";

export interface SymbolEntry {
	name: string;
	signature?: string;
	doc?: string;
	args?: DocArg[];
	arity?: Arity;
}

export type SymbolTable = ReadonlyMap<string, SymbolEntry>;

export interface Defined {
	globalNames(): string[];
	docs(): Map<string, Doc>;
	arityOf(name: string): Arity | undefined;
}

export function symbolsOf(defined: Defined): SymbolEntry[] {
	const docs = defined.docs();
	const names = new Set([...defined.globalNames(), ...docs.keys()]);
	return [...names]
		.filter((name) => !name.startsWith("_"))
		.map((name) => {
			const doc = docs.get(name);
			return {
				name,
				signature: doc?.signature,
				doc: doc?.doc,
				args: doc?.args,
				arity: defined.arityOf(name),
			};
		});
}

export function symbolTable(entries: readonly SymbolEntry[]): SymbolTable {
	return new Map(entries.map((entry) => [entry.name, entry]));
}
