import { restore } from "@repo/interpreter/image";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { backgroundExtension } from "../src/background.ts";
import { backgroundHostFor } from "../src/background-host.ts";
import type {
	BackgroundJobs,
	Clock,
	JobSpec,
	Outcome,
	Seen,
} from "../src/ports.ts";

class FakeClock implements Clock {
	at = 0;
	readonly slept: number[] = [];

	constructor(private readonly dice = 0.5) {}

	now(): number {
		return this.at;
	}

	random(): number {
		return this.dice;
	}

	private readonly timers: { at: number; wake: () => void }[] = [];

	sleep(ms: number, signal: AbortSignal): Promise<void> {
		if (signal.aborted) return Promise.reject(signal.reason);
		this.slept.push(ms);
		return new Promise((wake, stop) => {
			const timer = { at: this.at + ms, wake };
			this.timers.push(timer);
			signal.addEventListener(
				"abort",
				() => {
					this.timers.splice(this.timers.indexOf(timer), 1);
					stop(signal.reason);
				},
				{ once: true },
			);
			setTimeout(() => this.tick(), 0);
		});
	}

	private tick(): void {
		this.timers.sort((a, b) => a.at - b.at);
		const next = this.timers.shift();
		if (next === undefined) return;
		this.at = Math.max(this.at, next.at);
		next.wake();
	}
}

interface Running {
	readonly interp: Interp;
	readonly done: Promise<Outcome>;
	outcome?: Outcome;
	cancelled: boolean;
}

export class InProcessJobs implements BackgroundJobs {
	readonly specs: JobSpec[] = [];
	private readonly running = new Map<string, Running>();

	constructor(
		private readonly clock: Clock &
			Pick<BackgroundJobs, "sleep"> = new FakeClock(),
	) {}

	async start(spec: JobSpec): Promise<string> {
		this.specs.push(spec);
		const job = `job-${this.specs.length}`;
		const interp = session(this, this.clock, job);
		if (spec.fork !== null) restore(interp, spec.fork);
		const entry: Running = {
			interp,
			cancelled: false,
			done: runAsync(interp, spec.code).then(
				({ value }): Outcome => ({ value: str(value) }),
				(error: unknown): Outcome => ({
					failure: entry.cancelled ? "cancelled" : String(error),
				}),
			),
		};
		void entry.done.then((outcome) => {
			entry.outcome = outcome;
		});
		this.running.set(job, entry);
		return job;
	}

	state(job: string): Seen {
		const entry = this.running.get(job);
		if (entry === undefined) return { state: "lost" };
		if (entry.cancelled) return { state: "cancelled" };
		if (entry.outcome === undefined) return { state: "pending" };
		return {
			state: "value" in entry.outcome ? "done" : "failed",
			outcome: entry.outcome,
		};
	}

	async wait(job: string): Promise<Outcome> {
		return (
			(await this.running.get(job)?.done) ?? { failure: "lost in a restart" }
		);
	}

	cancel(job: string): boolean {
		const entry = this.running.get(job);
		if (entry === undefined || entry.outcome !== undefined) return false;
		entry.cancelled = true;
		entry.interp.async.abortAll();
		return true;
	}

	sleep(ms: number, signal: AbortSignal): Promise<void> {
		return this.clock.sleep(ms, signal);
	}
}

export function session(
	jobs: BackgroundJobs,
	clock: Clock,
	thread: string | null = "root",
): Interp {
	const interp = new Interp({
		extensions: [
			backgroundExtension(
				backgroundHostFor({
					jobs,
					clock,
					...(thread === null ? {} : { thread }),
				}),
			),
		],
	});
	runSync(interp, prelude);
	return interp;
}

export function world(dice = 0.5) {
	const clock = new FakeClock(dice);
	const jobs = new InProcessJobs(clock);
	const interp = session(jobs, clock);
	const shown = async (code: string) =>
		str((await runAsync(interp, code)).value);
	return { clock, jobs, interp, shown };
}
