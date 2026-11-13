export function pipe<T>(arg: T): T;
export function pipe<T1, T2>(arg: T1, fn1: (arg: T1) => T2): T2;
export function pipe<T1, T2, T3>(
	arg: T1,
	fn1: (arg: T1) => T2,
	fn2: (arg: T2) => T3,
): T3;
export function pipe<T1, T2, T3, T4>(
	arg: T1,
	fn1: (arg: T1) => T2,
	fn2: (arg: T2) => T3,
	fn3: (arg: T3) => T4,
): T4;
export function pipe<T1, T2, T3, T4, T5>(
	arg: T1,
	fn1: (arg: T1) => T2,
	fn2: (arg: T2) => T3,
	fn3: (arg: T3) => T4,
	fn4: (arg: T4) => T5,
): T5;
export function pipe<T1, T2, T3, T4, T5, T6>(
	arg: T1,
	fn1: (arg: T1) => T2,
	fn2: (arg: T2) => T3,
	fn3: (arg: T3) => T4,
	fn4: (arg: T4) => T5,
	fn5: (arg: T5) => T6,
): T6;
export function pipe<T1, T2, T3, T4, T5, T6, T7>(
	arg: T1,
	fn1: (arg: T1) => T2,
	fn2: (arg: T2) => T3,
	fn3: (arg: T3) => T4,
	fn4: (arg: T4) => T5,
	fn5: (arg: T5) => T6,
	fn6: (arg: T6) => T7,
): T7;
export function pipe<T1, T2, T3, T4, T5, T6, T7, T8>(
	arg: T1,
	fn1: (arg: T1) => T2,
	fn2: (arg: T2) => T3,
	fn3: (arg: T3) => T4,
	fn4: (arg: T4) => T5,
	fn5: (arg: T5) => T6,
	fn6: (arg: T6) => T7,
	fn7: (arg: T7) => T8,
): T8;
export function pipe(arg: unknown, ...fns: Array<(arg: unknown) => unknown>) {
	return fns.reduce((acc, fn) => fn(acc), arg);
}
