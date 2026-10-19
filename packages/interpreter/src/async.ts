import { LispPromise, type PromiseState } from "./promise.ts";
import type { Recipe } from "./recovery.ts";

export type { PromiseState };

export class AsyncWork {
	private readonly controllers = new WeakMap<LispPromise, AbortController>();
	private readonly lispPromises = new WeakMap<Promise<unknown>, LispPromise>();
	private readonly live = new Set<LispPromise>();

	start(
		run: (signal: AbortSignal) => Promise<unknown>,
		recipe?: Recipe,
	): LispPromise {
		return this.resume(new LispPromise(), run, recipe);
	}

	resume(
		into: LispPromise,
		run: (signal: AbortSignal) => Promise<unknown>,
		recipe?: Recipe,
	): LispPromise {
		const controller = new AbortController();
		this.controllers.set(into, controller);
		let running: Promise<unknown>;
		try {
			running = run(controller.signal);
		} catch (error) {
			running = Promise.reject(error);
		}
		return this.record(running, recipe, into);
	}

	watch(promise: Promise<unknown>, recipe?: Recipe): LispPromise {
		return this.lispPromises.get(promise) ?? this.record(promise, recipe);
	}

	stateOf(lispPromise: LispPromise): PromiseState {
		return lispPromise.state;
	}

	promiseOf(lispPromise: LispPromise): Promise<unknown> {
		return lispPromise.promise();
	}

	pending(): LispPromise[] {
		return [...this.live];
	}

	cancel(lispPromise: LispPromise): boolean {
		this.live.delete(lispPromise);
		const controller = this.controllers.get(lispPromise);
		if (!controller) return false;
		controller.abort();
		return true;
	}

	abortAll(): void {
		for (const lispPromise of this.live)
			this.controllers.get(lispPromise)?.abort();
		this.live.clear();
	}

	private record(
		promise: Promise<unknown>,
		recipe: Recipe | undefined,
		into = new LispPromise(),
	): LispPromise {
		const lispPromise = into.follow(promise, recipe);
		this.lispPromises.set(promise, lispPromise);
		this.live.add(lispPromise);
		const settle = () => {
			this.live.delete(lispPromise);
		};
		promise.then(settle, settle);
		return lispPromise;
	}
}
