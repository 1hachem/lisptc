import type { State, StateCodec } from "@repo/interpreter/lisp";
import { arrayToList, Cell } from "@repo/interpreter/objects";

export interface Handle {
	readonly name: string;
	readonly child: string;
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
			handles.map(({ name, child, unsaved }) =>
				arrayToList(
					unsaved === undefined ? [name, child] : [name, child, unsaved],
				),
			),
		),
	fromLisp: (x) =>
		itemsOf(x).flatMap((item) => {
			const [name, child, unsaved] = itemsOf(item);
			if (typeof name !== "string" || typeof child !== "string") return [];
			return typeof unsaved === "string"
				? [{ name, child, unsaved }]
				: [{ name, child }];
		}),
};

export class Handles {
	constructor(private readonly held: State<readonly Handle[]>) {}

	of(name: string): Handle | undefined {
		return this.held.get().find((entry) => entry.name === name);
	}

	child(name: string): string | undefined {
		return this.of(name)?.child;
	}

	names(): string[] {
		return this.held.get().map((entry) => entry.name);
	}

	adopt(handle: Handle): void {
		this.held.set([
			...this.held.get().filter((entry) => entry.name !== handle.name),
			handle,
		]);
	}
}
