export function assertNever(_never: never, message?: string): never {
	throw new Error(
		message || `Reached unreachable code: unexpected value ${_never}`,
	);
}

export function assert(
	condition: boolean,
	msg?: string | (() => void),
): asserts condition {
	if (!condition) {
		if (typeof msg === "function") {
			console.group("Assertion failed; debug info:");
			msg();
			console.groupEnd();
			throw new Error("Assertion failed");
		} else {
			throw new Error(msg ?? "Assertion failed");
		}
	}
}

export function assertDefined<T>(
	x: T | undefined | null,
	msg?: string | (() => void),
): T {
	if (x === undefined || x === null) {
		if (typeof msg === "function") {
			console.group("Assertion failed; debug info:");
			msg();
			console.groupEnd();
			throw new Error("Assertion failed: value is undefined or null");
		} else {
			throw new Error(msg ?? "Assertion failed: value is undefined or null");
		}
	}
	return x;
}

export function assertWarning(
	condition: boolean,
	msg?: string | (() => void),
): void {
	if (!condition) {
		if (typeof msg === "function") {
			console.group("Warning assertion failed; debug info:");
			msg();
			console.groupEnd();
		} else {
			console.warn("Warning assertion failed:", msg || "");
		}
	}
}
