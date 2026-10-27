import type { State, StateCodec } from "@repo/interpreter/lisp";
import { arrayToList, Cell } from "@repo/interpreter/objects";

export interface Handle {
	readonly name: string;
	readonly unsaved?: string;
}

export function itemsOf(x: unknown): unknown[] {
	const items: unknown[] = [];
	for (let at = x; at instanceof Cell; at = at.cdr) items.push(at.car);
	return items;
}

export const handlesCodec: StateCodec<readonly Handle[]> = {
	toLisp: (handles) =>
		arrayToList(
			handles.map(({ name, unsaved }) =>
				arrayToList(unsaved === undefined ? [name] : [name, unsaved]),
			),
		),
	fromLisp: (x) =>
		itemsOf(x).flatMap((item) => {
			const [name, unsaved] = itemsOf(item);
			if (typeof name !== "string") return [];
			return typeof unsaved === "string" ? [{ name, unsaved }] : [{ name }];
		}),
};

export class Handles {
	constructor(private readonly held: State<readonly Handle[]>) {}

	of(name: string): Handle | undefined {
		return this.held.get().find((entry) => entry.name === name);
	}

	names(): string[] {
		return this.held.get().map((entry) => entry.name);
	}

	adopt(handle: Handle): void {
		this.held.set([...this.held.get(), handle]);
	}

	saved(name: string): void {
		this.held.set(
			this.held.get().map((entry) => (entry.name === name ? { name } : entry)),
		);
	}
}
