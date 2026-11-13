import type { Clock } from "@repo/shared/host";
import type { Eval } from "./drive.ts";

export interface Phase {
	readonly state: "started" | "done" | "failed";
	readonly startedAt: number;
	readonly ms?: number;
	readonly error?: unknown;
}

export type PhaseReport<T> = (phase: Phase, value?: T) => void;

function stopwatch<T>(clock: Clock, report: PhaseReport<T>) {
	const startedAt = clock.now();
	report({ state: "started", startedAt });
	const ms = () => clock.now() - startedAt;
	return {
		done(value: T): T {
			report({ state: "done", startedAt, ms: ms() }, value);
			return value;
		},
		failed(error: unknown): never {
			report({ state: "failed", startedAt, ms: ms(), error });
			throw error;
		},
	};
}

export function timed<T>(
	clock: Clock,
	run: () => Promise<T>,
	report: PhaseReport<T>,
): Promise<T> {
	const watch = stopwatch(clock, report);
	let running: Promise<T>;
	try {
		running = run();
	} catch (error) {
		running = Promise.reject(error);
	}
	return running.then(watch.done, watch.failed);
}

export function* timedEval<T>(
	clock: Clock,
	run: () => Eval<T>,
	report: PhaseReport<T>,
): Eval<T> {
	const watch = stopwatch(clock, report);
	let value: T;
	try {
		value = yield* run();
	} catch (error) {
		return watch.failed(error);
	}
	return watch.done(value);
}
