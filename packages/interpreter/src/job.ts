export type JobState = "pending" | "fulfilled" | "rejected";

export class Job implements PromiseLike<unknown> {
	private running: Promise<unknown> | undefined;

	constructor(
		public state: JobState = "pending",
		public outcome: unknown = null,
	) {}

	static of(promise: Promise<unknown>): Job {
		const job = new Job();
		job.running = promise;
		promise.then(
			(value) => {
				job.state = "fulfilled";
				job.outcome = value;
			},
			(error: unknown) => {
				job.state = "rejected";
				job.outcome = error;
			},
		);
		return job;
	}

	promise(): Promise<unknown> {
		if (this.running !== undefined) return this.running;
		return this.state === "rejected"
			? Promise.reject(this.outcome)
			: Promise.resolve(this.outcome);
	}

	// biome-ignore lint/suspicious/noThenProperty: a job stands where a Lisp promise used to be a native one, so host code awaiting it keeps working
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
