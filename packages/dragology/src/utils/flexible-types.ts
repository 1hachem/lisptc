import { isArray } from "./js";

export type Many<T> = T | readonly Many<T>[] | undefined | null | false;

export function manyToArray<T>(a: Many<T>): T[] {
	const result: T[] = [];
	function helper(a: Many<T>) {
		if (a === undefined || a === null || a === false) {
			return;
		} else if (isArray(a)) {
			a.forEach(helper);
		} else {
			result.push(a);
		}
	}
	helper(a);
	return result;
}

export type Reader<T, S> = T | ((s: S) => Reader<T, S>);

export function readerToValue<T, S>(a: Reader<T, S>, s: S): T {
	if (typeof a === "function") {
		return readerToValue((a as (s: S) => Reader<T, S>)(s), s);
	} else {
		return a;
	}
}

export type ManyReader<T, S extends unknown[]> = Many<
	T | ((...s: S) => ManyReader<T, S>)
>;

export function manyReaderToArray<T, S extends unknown[]>(
	a: ManyReader<T, S>,
	...s: S
): T[] {
	const result: T[] = [];
	function helper(a: ManyReader<T, S>) {
		for (const leaf of manyToArray(a)) {
			if (typeof leaf === "function") {
				helper((leaf as (...s: S) => ManyReader<T, S>)(...s));
			} else {
				result.push(leaf);
			}
		}
	}
	helper(a);
	return result;
}
