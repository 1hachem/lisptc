export function FindMinimum(
	calcfc: (n: number, m: number, x: Float64Array, con: Float64Array) => number,
	n: number,
	m: number,
	x: number[],
	rhobeg: number,
	rhoend: number,
	iprint: number,
	maxfun: number,
): number;
