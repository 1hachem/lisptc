import type { State, StateCodec } from "@repo/interpreter/lisp";
import { arrayToList, Cell } from "@repo/interpreter/objects";

export interface Handle {
	readonly name: string;
	readonly child: string;
	readonly unsaved?: string;
	readonly job?: string;
}

export function itemsOf(x: unknown): unknown[] {
	const items: unknown[] = [];
	for (let at = x; at instanceof Cell; at = at.cdr) items.push(at.car);
	return items;
}

export const handlesCodec: StateCodec<readonly Handle[]> = {
	toLisp: (handles) =>
		arrayToList(
			handles.map(({ name, child, unsaved, job }) =>
				arrayToList([name, child, unsaved ?? null, job ?? null]),
			),
		),
	fromLisp: (x) =>
		itemsOf(x).flatMap((item) => {
			const [name, child, unsaved, job] = itemsOf(item);
			if (typeof name !== "string" || typeof child !== "string") return [];
			return [
				{
					name,
					child,
					...(typeof unsaved === "string" ? { unsaved } : {}),
					...(typeof job === "string" ? { job } : {}),
				},
			];
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

	saved(name: string): void {
		this.update(name, ({ unsaved: _, ...kept }) => kept);
	}

	sent(name: string, job: string): string {
		this.update(name, (handle) => ({ ...handle, job }));
		return name;
	}

	private update(name: string, change: (handle: Handle) => Handle): void {
		this.held.set(
			this.held
				.get()
				.map((entry) => (entry.name === name ? change(entry) : entry)),
		);
	}
}
