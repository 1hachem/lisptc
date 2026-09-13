import { EvalException } from "./lisp.ts";

export type PromiseState = "pending" | "fulfilled" | "rejected";

export function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	what: string,
): Promise<T> {
	if (!Number.isFinite(timeoutMs)) return promise;
	let timer: ReturnType<typeof setTimeout>;
	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new EvalException(`${what} timed out`, timeoutMs, false)),
				timeoutMs,
			);
			timer.unref?.();
		}),
	]);
}

interface Tracked {
	state: PromiseState;
	controller?: AbortController;
}

export class AsyncWork {
	private readonly tracked = new WeakMap<Promise<unknown>, Tracked>();
	private readonly live = new Set<Promise<unknown>>();

	start<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const controller = new AbortController();
		return this.record(run(controller.signal), controller);
	}

	watch<T>(promise: Promise<T>): Promise<T> {
		return this.tracked.has(promise) ? promise : this.record(promise);
	}

	stateOf(promise: Promise<unknown>): PromiseState | "unknown" {
		return this.tracked.get(promise)?.state ?? "unknown";
	}

	pending(): Promise<unknown>[] {
		return [...this.live];
	}

	cancel(promise: Promise<unknown>): boolean {
		this.live.delete(promise);
		const controller = this.tracked.get(promise)?.controller;
		if (!controller) return false;
		controller.abort();
		return true;
	}

	abortAll(): void {
		for (const promise of this.live)
			this.tracked.get(promise)?.controller?.abort();
		this.live.clear();
	}

	private record<T>(
		promise: Promise<T>,
		controller?: AbortController,
	): Promise<T> {
		const record: Tracked = { state: "pending", controller };
		this.tracked.set(promise, record);
		this.live.add(promise);
		promise.then(
			() => {
				record.state = "fulfilled";
				this.live.delete(promise);
			},
			() => {
				record.state = "rejected";
				this.live.delete(promise);
			},
		);
		return promise;
	}
}
