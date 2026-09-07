import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
	Cell,
	EvalException,
	type Interp,
	type List,
	newLispKeyword,
	zList,
} from "./lisp.ts";
import type { ToJson } from "./types.ts";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const AWAIT_TIMEOUT_MS = 50_000;

export type SettledReply = {
	jobId: string;
	ok: boolean;
	v?: unknown;
	e?: string;
};

export type JobSettledMessage = {
	type?: string;
	jobId?: string;
	ok?: boolean;
	v?: unknown;
	e?: string;
};

export interface JobsRuntime {
	call(op: string, payload: unknown, timeoutMs?: number): Promise<unknown>;
	start(op: string, payload: unknown): string;
	awaitJob(jobId: string, timeoutMs?: number): Promise<unknown>;
	awaitAll(
		jobIds: string[],
		timeoutMs?: number,
	): Promise<{ results: SettledReply[] }>;
	awaitAny(jobIds: string[], timeoutMs?: number): Promise<SettledReply>;
	jobStatus(jobId: string): string;
	cancelJob(jobId: string): void;
	onSettled(handler: (msg: JobSettledMessage) => void): void;
	shutdown(): void;
}

export type Dispatch = (
	op: string,
	payload: unknown,
	signal?: AbortSignal,
) => Promise<unknown>;

interface JobRecord {
	promise: Promise<unknown>;
	controller: AbortController;
	state: "pending" | "done" | "error";
}

const message = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	what: string,
): Promise<T> {
	if (!Number.isFinite(timeoutMs)) return promise;
	let timer: NodeJS.Timeout;
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

export class LocalJobsRuntime implements JobsRuntime {
	private readonly records = new Map<string, JobRecord>();
	private settledHandler: ((msg: JobSettledMessage) => void) | undefined;

	constructor(private readonly dispatch: Dispatch) {}

	onSettled(handler: (msg: JobSettledMessage) => void): void {
		this.settledHandler = handler;
	}

	call(
		op: string,
		payload: unknown,
		timeoutMs = DEFAULT_TIMEOUT_MS,
	): Promise<unknown> {
		return withTimeout(this.dispatch(op, payload), timeoutMs, op);
	}

	start(op: string, payload: unknown): string {
		const jobId = randomUUID();
		const controller = new AbortController();
		const record: JobRecord = {
			promise: this.dispatch(op, payload, controller.signal),
			controller,
			state: "pending",
		};
		this.records.set(jobId, record);
		record.promise.then(
			(v) => {
				record.state = "done";
				this.settledHandler?.({ type: "job-settled", jobId, ok: true, v });
			},
			(e) => {
				record.state = "error";
				this.settledHandler?.({
					type: "job-settled",
					jobId,
					ok: false,
					e: message(e),
				});
			},
		);
		return jobId;
	}

	private record(jobId: string): JobRecord {
		const record = this.records.get(jobId);
		if (!record) throw new EvalException("no such job", jobId, false);
		return record;
	}

	awaitJob(jobId: string, timeoutMs = AWAIT_TIMEOUT_MS): Promise<unknown> {
		return withTimeout(this.record(jobId).promise, timeoutMs, "await");
	}

	private settled(jobId: string): Promise<SettledReply> {
		return this.record(jobId).promise.then(
			(v) => ({ jobId, ok: true as const, v }),
			(e) => ({ jobId, ok: false as const, e: message(e) }),
		);
	}

	awaitAll(
		jobIds: string[],
		timeoutMs = AWAIT_TIMEOUT_MS,
	): Promise<{ results: SettledReply[] }> {
		return withTimeout(
			Promise.all(jobIds.map((id) => this.settled(id))).then((results) => ({
				results,
			})),
			timeoutMs,
			"await-all",
		);
	}

	awaitAny(
		jobIds: string[],
		timeoutMs = AWAIT_TIMEOUT_MS,
	): Promise<SettledReply> {
		if (jobIds.length === 0)
			throw new EvalException("await-any: no jobs", null, false);
		return withTimeout(
			Promise.race(jobIds.map((id) => this.settled(id))),
			timeoutMs,
			"await-any",
		);
	}

	jobStatus(jobId: string): string {
		return this.records.get(jobId)?.state ?? "unknown";
	}

	cancelJob(jobId: string): void {
		const record = this.records.get(jobId);
		if (!record) return;
		record.controller.abort();
		this.records.delete(jobId);
	}

	shutdown(): void {
		for (const record of this.records.values()) record.controller.abort();
		this.records.clear();
	}
}

export class Job implements ToJson {
	finalized = false;
	cached: unknown;
	constructor(
		readonly jobId: string,
		readonly label: string,
		readonly finalize?: (raw: unknown) => unknown,
	) {}

	toString(): string {
		return `#<job ${this.label} ${this.jobId.slice(0, 8)}>`;
	}

	toJSON(): string {
		return this.jobId;
	}
}

const zJob = z.custom<Job>((x) => x instanceof Job, "job expected");

function toJobs(x: unknown): Job[] {
	const arr = x === null || x instanceof Cell ? listToArray(x as List) : [x];
	return arr.map((j) => {
		if (!(j instanceof Job)) throw new EvalException("not a job", j);
		return j;
	});
}

function parseTimeout(x: unknown): number {
	if (x === undefined) return AWAIT_TIMEOUT_MS;
	const ms = Number(x);
	if (!Number.isFinite(ms) || ms < 0)
		throw new EvalException("invalid await timeout", x);
	return ms;
}

function listToArray(list: List): unknown[] {
	const out: unknown[] = [];
	for (let j = list; j !== null; j = j.cdr as List) out.push(j.car);
	return out;
}

function arrayToList(arr: unknown[]): List {
	let out: List = null;
	for (let i = arr.length - 1; i >= 0; i--) out = new Cell(arr[i], out);
	return out;
}

export class Jobs {
	readonly live = new Set<Job>();

	constructor(
		readonly runtime: JobsRuntime,
		private readonly toLisp: (raw: unknown) => unknown,
	) {
		runtime.onSettled((msg) => {
			if (msg?.type !== "job-settled" || !msg.ok) return;
			for (const job of this.live) {
				if (job.jobId !== msg.jobId) continue;
				if (!job.finalized) {
					try {
						this.collect(job, msg.v);
					} catch {}
				}
				return;
			}
		});
	}

	track(job: Job): Job {
		this.live.add(job);
		return job;
	}

	collect(job: Job, raw: unknown): unknown {
		if (job.finalized) return job.cached;
		const value = job.finalize ? job.finalize(raw) : this.toLisp(raw);
		job.finalized = true;
		job.cached = value;
		this.live.delete(job);
		return value;
	}

	private collectSettled(job: Job, r: SettledReply): unknown {
		if (!r.ok) throw new EvalException("job error", r.e ?? "unknown", false);
		return this.collect(job, r.v);
	}

	shutdown(): void {
		this.live.clear();
		this.runtime.shutdown();
	}

	installBuiltins(interp: Interp): void {
		const { runtime } = this;

		interp.def(
			"await",
			-1,
			"(await job [timeout-ms])",
			"Block until an async job settles and return its result; re-raises the job's error. Optional timeout in milliseconds.",
			z.tuple([zList]),
			([rest]) => {
				const args = listToArray(rest);
				const job = args[0];
				if (!(job instanceof Job)) throw new EvalException("not a job", job);
				const timeout = parseTimeout(args[1]);
				if (job.finalized) return job.cached;
				return runtime
					.awaitJob(job.jobId, timeout)
					.then((raw) => this.collect(job, raw));
			},
		);

		interp.def(
			"await-all",
			-1,
			"(await-all jobs [timeout-ms])",
			"Block until every job in the list settles; return their results in order.",
			z.tuple([zList]),
			([rest]) => {
				const args = listToArray(rest);
				const jobList = toJobs(args[0]);
				if (jobList.length === 0) return null;
				const byId = new Map(jobList.map((j) => [j.jobId, j]));
				return runtime
					.awaitAll(
						jobList.map((j) => j.jobId),
						parseTimeout(args[1]),
					)
					.then(({ results }) =>
						arrayToList(
							results.map((r) => {
								const job = byId.get(r.jobId);
								if (!job)
									throw new EvalException("unknown job in await-all", r.jobId);
								if (!r.ok)
									return arrayToList([
										newLispKeyword("error"),
										r.e ?? "unknown",
									]);
								return this.collect(job, r.v);
							}),
						),
					);
			},
		);

		interp.def(
			"await-any",
			-1,
			"(await-any jobs [timeout-ms])",
			"Block until the first job in the list settles; return that one result.",
			z.tuple([zList]),
			([rest]) => {
				const args = listToArray(rest);
				const jobList = toJobs(args[0]);
				if (jobList.length === 0)
					throw new EvalException("await-any: no jobs", null);
				const byId = new Map(jobList.map((j) => [j.jobId, j]));
				return runtime
					.awaitAny(
						jobList.map((j) => j.jobId),
						parseTimeout(args[1]),
					)
					.then((r) => {
						const job = byId.get(r.jobId);
						if (!job)
							throw new EvalException("unknown job in await-any", r.jobId);
						return this.collectSettled(job, r);
					});
			},
		);

		interp.def(
			"job-status",
			1,
			"(job-status job)",
			"Return the status of an async job as a keyword: :pending, :done, or :error.",
			z.tuple([zJob]),
			([job]) =>
				newLispKeyword(job.finalized ? "done" : runtime.jobStatus(job.jobId)),
		);

		interp.def(
			"jobs",
			0,
			"(jobs)",
			"Return the in-flight async jobs, each as (job :status). Settled jobs are reaped.",
			z.tuple([]),
			() =>
				arrayToList(
					[...this.live].map((job) =>
						arrayToList([
							job,
							newLispKeyword(
								job.finalized ? "done" : runtime.jobStatus(job.jobId),
							),
						]),
					),
				),
		);

		interp.def(
			"cancel",
			1,
			"(cancel job)",
			"Cancel an async job (best-effort) and stop tracking it.",
			z.tuple([zJob]),
			([job]) => {
				runtime.cancelJob(job.jobId);
				this.live.delete(job);
				return true;
			},
		);
	}
}
