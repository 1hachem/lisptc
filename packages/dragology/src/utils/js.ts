export function objectKeys<T extends object>(obj: T): (keyof T)[] {
	return Object.keys(obj) as (keyof T)[];
}

export function isArray<T>(x: T | readonly T[] | T[]): x is readonly T[] | T[] {
	return Array.isArray(x);
}
