import { Job, type JobState } from "./job.ts";

export type PromiseState = JobState;

export class AsyncWork {
	private readonly controllers = new WeakMap<Job, AbortController>();
	private readonly jobs = new WeakMap<Promise<unknown>, Job>();
	private readonly live = new Set<Job>();

	start(run: (signal: AbortSignal) => Promise<unknown>): Job {
		const controller = new AbortController();
		const job = this.record(run(controller.signal));
		this.controllers.set(job, controller);
		return job;
	}

	watch(promise: Promise<unknown>): Job {
		return this.jobs.get(promise) ?? this.record(promise);
	}

	stateOf(job: Job): PromiseState {
		return job.state;
	}

	promiseOf(job: Job): Promise<unknown> {
		return job.promise();
	}

	pending(): Job[] {
		return [...this.live];
	}

	cancel(job: Job): boolean {
		this.live.delete(job);
		const controller = this.controllers.get(job);
		if (!controller) return false;
		controller.abort();
		return true;
	}

	abortAll(): void {
		for (const job of this.live) this.controllers.get(job)?.abort();
		this.live.clear();
	}

	private record(promise: Promise<unknown>): Job {
		const job = Job.of(promise);
		this.jobs.set(promise, job);
		this.live.add(job);
		const settle = () => {
			this.live.delete(job);
		};
		promise.then(settle, settle);
		return job;
	}
}
