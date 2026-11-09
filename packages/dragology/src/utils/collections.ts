export function range(count: number): number[] {
	return Array.from({ length: Math.max(0, count) }, (_, i) => i);
}

export function minBy<T>(
	items: readonly T[],
	score: (item: T) => number,
): T | undefined {
	let best: T | undefined;
	let lowest = Infinity;
	for (const item of items) {
		const value = score(item);
		if (value < lowest) {
			lowest = value;
			best = item;
		}
	}
	return best;
}

export function memoize<K, V>(compute: (key: K) => V): (key: K) => V {
	const known = new Map<K, V>();
	return (key) => {
		if (known.has(key)) return known.get(key) as V;
		const value = compute(key);
		known.set(key, value);
		return value;
	};
}

export function isEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;
	return keysA.every(
		(key) =>
			Object.hasOwn(b, key) &&
			isEqual(
				(a as Record<string, unknown>)[key],
				(b as Record<string, unknown>)[key],
			),
	);
}
