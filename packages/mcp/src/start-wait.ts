import { setTimeout as sleep } from "node:timers/promises";
import type { StartWatch } from "./ports.ts";

export interface StartLimits {
	pollMs: number;
	stallMs: number;
	ceilingMs: number;
}

export const START_LIMITS = {
	process: { pollMs: 250, stallMs: 60_000, ceilingMs: 60_000 },
	docker: { pollMs: 250, stallMs: 120_000, ceilingMs: 120_000 },
	cluster: { pollMs: 1_000, stallMs: 300_000, ceilingMs: 900_000 },
} as const satisfies Record<string, StartLimits>;

const REACH_TIMEOUT_MS = 2_000;

export async function reachable(url: string): Promise<boolean> {
	try {
		await fetch(url, {
			method: "HEAD",
			signal: AbortSignal.timeout(REACH_TIMEOUT_MS),
		});
		return true;
	} catch {
		return false;
	}
}

export type StartCheck<T> = { ready: T } | { waiting: string };

export interface StartGaveUp {
	note: string;
	seconds: number;
	stalled: boolean;
}

export async function waitForStart<T>(
	check: () => Promise<StartCheck<T>>,
	limits: StartLimits,
	gaveUp: (why: StartGaveUp) => Error,
	watch: StartWatch = {},
): Promise<T> {
	const began = Date.now();
	let note = "";
	let since = began;
	for (;;) {
		watch.signal?.throwIfAborted();
		const step = await check();
		if ("ready" in step) return step.ready;
		const now = Date.now();
		if (step.waiting !== note) {
			note = step.waiting;
			since = now;
			watch.progress?.(note);
		}
		const stalled = now - since >= limits.stallMs;
		if (stalled || now - began >= limits.ceilingMs)
			throw gaveUp({
				note,
				seconds: Math.round((now - (stalled ? since : began)) / 1000),
				stalled,
			});
		await sleep(limits.pollMs, undefined, { signal: watch.signal });
	}
}
