import type { Recipe } from "./recovery.ts";

export type PromiseState = "pending" | "fulfilled" | "rejected";

export class LispPromise implements PromiseLike<unknown> {
	private running: Promise<unknown> | undefined;

	recipe: Recipe | undefined;

	constructor(
		public state: PromiseState = "pending",
		public outcome: unknown = null,
	) {}

	static of(promise: Promise<unknown>, recipe?: Recipe): LispPromise {
		return new LispPromise().follow(promise, recipe);
	}

	follow(promise: Promise<unknown>, recipe?: Recipe): LispPromise {
		this.state = "pending";
		this.outcome = null;
		this.recipe = recipe;
		this.running = promise;
		promise.then(
			(value) => {
				this.state = "fulfilled";
				this.outcome = value;
				this.recipe = undefined;
			},
			(error: unknown) => {
				this.state = "rejected";
				this.outcome = error;
				this.recipe = undefined;
			},
		);
		return this;
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
