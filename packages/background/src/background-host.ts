import { filePrompt } from "@repo/shared/host-node";
import type { BackgroundHost } from "./background.ts";
import type { BackgroundJobs, Clock, Outcome } from "./ports.ts";

export function timerSleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((wake, stop) => {
		if (signal.aborted) return stop(signal.reason);
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			wake();
		}, ms);
		const abort = () => {
			clearTimeout(timer);
			stop(signal.reason);
		};
		signal.addEventListener("abort", abort, { once: true });
	});
}

export const systemClock: Clock = {
	now: () => Date.now(),
	random: () => Math.random(),
};

const NONE: Outcome = { failure: "this session runs no background jobs" };

export const noJobs: BackgroundJobs = {
	start: () => Promise.reject(new Error(NONE.failure)),
	state: () => ({ state: "lost", outcome: NONE }),
	wait: () => Promise.resolve(NONE),
	cancel: () => false,
	sleep: timerSleep,
};

export interface BackgroundHostOptions {
	jobs?: BackgroundJobs;
	thread?: string;
	clock?: Clock;
}

export function backgroundHostFor(
	options: BackgroundHostOptions = {},
): BackgroundHost {
	return {
		prompt: filePrompt(new URL("./background.ptc", import.meta.url)),
		jobs: options.jobs ?? noJobs,
		clock: options.clock ?? systemClock,
		...(options.thread === undefined ? {} : { thread: options.thread }),
	};
}
