export type Middleware<A extends unknown[], R> = (
	...args: [...A, next: (...a: A) => R]
) => R;

export class Chain<A extends unknown[], R> {
	private readonly middlewares: Middleware<A, R>[] = [];

	get isEmpty(): boolean {
		return this.middlewares.length === 0;
	}

	use(middleware: Middleware<A, R>): void {
		this.middlewares.push(middleware);
	}

	run(base: (...a: A) => R, ...args: A): R {
		let next = base;
		for (let i = this.middlewares.length - 1; i >= 0; i--) {
			const middleware = this.middlewares[i];
			const rest = next;
			next = (...a: A) => middleware(...a, rest);
		}
		return next(...args);
	}
}

export function noOpinion(): undefined {
	return undefined;
}
