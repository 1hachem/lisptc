export function clamp(a: number, b: number, c: number): number {
	return a + b + c - Math.max(a, b, c) - Math.min(a, b, c);
}

export function adjPairs<T>(l: T[]): [T, T][] {
	const result: [T, T][] = [];
	for (let i = 0; i < l.length - 1; i++) {
		result.push([l[i], l[i + 1]]);
	}
	return result;
}
