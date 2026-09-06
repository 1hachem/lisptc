export type Numeric = number | bigint;

export const ZERO = typeof BigInt === "undefined" ? 0 : BigInt(0);
export const ONE = typeof BigInt === "undefined" ? 1 : BigInt(1);

export function isNumeric(x: unknown): x is Numeric {
	const t = typeof x;
	return t === "number" || t === "bigint";
}

export function add(x: Numeric, y: Numeric): Numeric {
	if (typeof x === "number") {
		if (typeof y === "number") return x + y;
		else return x + Number(y);
	} else {
		if (typeof y === "number") return Number(x) + y;
		else return x + y;
	}
}

export function subtract(x: Numeric, y: Numeric): Numeric {
	if (typeof x === "number") {
		if (typeof y === "number") return x - y;
		else return x - Number(y);
	} else {
		if (typeof y === "number") return Number(x) - y;
		else return x - y;
	}
}

export function multiply(x: Numeric, y: Numeric): Numeric {
	if (typeof x === "number") {
		if (typeof y === "number") return x * y;
		else return x * Number(y);
	} else {
		if (typeof y === "number") return Number(x) * y;
		else return x * y;
	}
}

export function divide(x: Numeric, y: Numeric): Numeric {
	return Number(x) / Number(y);
}

export function quotient(x: Numeric, y: Numeric): Numeric {
	if (typeof x === "number" || typeof y === "number") {
		const q = Math.trunc(Number(x) / Number(y));
		if (typeof BigInt === "undefined") return q;
		else return BigInt(q);
	} else {
		return x / y;
	}
}

export function remainder(x: Numeric, y: Numeric): Numeric {
	if (typeof x === "number" || typeof y === "number")
		return Number(x) % Number(y);
	else return x % y;
}

export function compare(x: Numeric, y: Numeric): number {
	if (typeof x === "number") {
		if (typeof y === "number") return Math.sign(x - y);
		else return Math.sign(x - Number(y));
	} else {
		if (typeof y === "number") return Math.sign(Number(x) - y);
		else return x < y ? -1 : y < x ? 1 : 0;
	}
}

export function tryToParse(token: string): Numeric | null {
	try {
		return BigInt(token);
	} catch (_ex) {
		const n = Number(token);
		if (Number.isNaN(n)) return null;
		return n;
	}
}

export function convertToString(x: Numeric): string {
	const s = `${x}`;
	if (typeof BigInt !== "undefined")
		if (typeof x === "number")
			if (Number.isInteger(x) && !s.includes("e")) return `${s}.0`;
	return s;
}
