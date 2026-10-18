export type PromiseState = "pending" | "fulfilled" | "rejected";

export class LispPromise implements PromiseLike<unknown> {
	private running: Promise<unknown> | undefined;

	constructor(
		public state: PromiseState = "pending",
		public outcome: unknown = null,
	) {}

	static of(promise: Promise<unknown>): LispPromise {
		const lispPromise = new LispPromise();
		lispPromise.running = promise;
		promise.then(
			(value) => {
				lispPromise.state = "fulfilled";
				lispPromise.outcome = value;
			},
			(error: unknown) => {
				lispPromise.state = "rejected";
				lispPromise.outcome = error;
			},
		);
		return lispPromise;
	}

	promise(): Promise<unknown> {
		if (this.running !== undefined) return this.running;
		return this.state === "rejected"
			? Promise.reject(this.outcome)
			: Promise.resolve(this.outcome);
	}

	// biome-ignore lint/suspicious/noThenProperty: a Lisp promise stood as a native one before it carried its own state, so host code awaiting it keeps working
	then<A = unknown, B = never>(
		fulfilled?: ((value: unknown) => A | PromiseLike<A>) | null,
		rejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
	): Promise<A | B> {
		return this.promise().then(fulfilled, rejected);
	}

	toString(): string {
		return "#<promise>";
	}
}
