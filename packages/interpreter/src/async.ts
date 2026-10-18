import { LispPromise, type PromiseState } from "./promise.ts";

export type { PromiseState };

export class AsyncWork {
	private readonly controllers = new WeakMap<LispPromise, AbortController>();
	private readonly lispPromises = new WeakMap<Promise<unknown>, LispPromise>();
	private readonly live = new Set<LispPromise>();

	start(run: (signal: AbortSignal) => Promise<unknown>): LispPromise {
		const controller = new AbortController();
		const lispPromise = this.record(run(controller.signal));
		this.controllers.set(lispPromise, controller);
		return lispPromise;
	}

	watch(promise: Promise<unknown>): LispPromise {
		return this.lispPromises.get(promise) ?? this.record(promise);
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

	private record(promise: Promise<unknown>): LispPromise {
		const lispPromise = LispPromise.of(promise);
		this.lispPromises.set(promise, lispPromise);
		this.live.add(lispPromise);
		const settle = () => {
			this.live.delete(lispPromise);
		};
		promise.then(settle, settle);
		return lispPromise;
	}
}
