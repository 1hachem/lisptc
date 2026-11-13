import { type Draft, produce } from "immer";

class AmbError extends Error {
	constructor(public optionsLength: number) {
		super("AmbError");
	}
}

class FailError extends Error {
	constructor() {
		super("FailError");
	}
}

let currentPath: number[] = [];
let currentAmbIndex = 0;

export function amb<T>(options: T[]): T {
	const myIndex = currentAmbIndex++;

	if (myIndex < currentPath.length) {
		return options[currentPath[myIndex]];
	}

	throw new AmbError(options.length);
}

function generateAmb<T>(fn: () => T): Generator<T> {
	return generateAmbHelper(fn, []);
}

function* generateAmbHelper<T>(fn: () => T, path: number[]): Generator<T> {
	try {
		currentPath = path;
		currentAmbIndex = 0;
		yield fn();
	} catch (error) {
		if (error instanceof AmbError) {
			for (let i = 0; i < error.optionsLength; i++) {
				yield* generateAmbHelper(fn, [...path, i]);
			}
		} else if (error instanceof FailError) {
			return;
		} else {
			throw error;
		}
	}
}

export function runAmb<T>(fn: () => T): T[] {
	return [...generateAmb(fn)];
}

export function fail(): never {
	throw new FailError();
}

export function require(condition: boolean): void {
	if (!condition) fail();
}

export function produceAmb<T>(base: T, recipe: (draft: Draft<T>) => void): T[] {
	return runAmb(() => produce(base, recipe));
}
