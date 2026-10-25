import type { StateCodec } from "@repo/interpreter/lisp";
import { arrayToList, Cell } from "@repo/interpreter/objects";

export interface Handle {
	readonly name: string;
	readonly child: string;
}

function itemsOf(x: unknown): unknown[] {
	const items: unknown[] = [];
	for (let at = x; at instanceof Cell; at = at.cdr) items.push(at.car);
	return items;
}

export const handlesCodec: StateCodec<readonly Handle[]> = {
	toLisp: (handles) =>
		arrayToList(handles.map(({ name, child }) => arrayToList([name, child]))),
	fromLisp: (x) =>
		itemsOf(x).flatMap((item) => {
			const [name, child] = itemsOf(item);
			return typeof name === "string" && typeof child === "string"
				? [{ name, child }]
				: [];
		}),
};
