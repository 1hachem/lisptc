import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { kgExtension } from "../src/kg.ts";
import { kgHostFor } from "../src/kg-host.ts";
import type { GraphStore, StoredGraph } from "../src/ports.ts";

export class MemoryGraphStore implements GraphStore {
	readonly graphs = new Map<string, string>();

	all(): StoredGraph[] {
		return [...this.graphs].map(([name, source]) => ({ name, source }));
	}

	put({ name, source }: StoredGraph): void {
		this.graphs.set(name, source);
	}

	remove(name: string): boolean {
		return this.graphs.delete(name);
	}
}

export function kgRepl(
	store: GraphStore = new MemoryGraphStore(),
): (code: string) => string {
	const interp = new Interp({
		extensions: [kgExtension(kgHostFor({ store }))],
	});
	runSync(interp, prelude);
	return (code) => str(runSync(interp, code));
}
