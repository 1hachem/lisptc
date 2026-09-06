import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { z } from "zod";
import {
	AWAIT_TIMEOUT_MS,
	CTRL_BYTES,
	DATA_BYTES,
	DEFAULT_TIMEOUT_MS,
	type JobSettledMessage,
	type SettledReply,
	STATE_ERROR,
	STATE_PENDING,
	STATE_SPILL,
} from "./jobs-protocol.ts";
import {
	Cell,
	EvalException,
	type Interp,
	type List,
	newLispKeyword,
	zList,
} from "./lisp.ts";
import type { ToJson } from "./types.ts";

export type { JobSettledMessage, SettledReply } from "./jobs-protocol.ts";

export interface JobsRuntime {
	call(op: string, payload: unknown, timeoutMs?: number): unknown;
	start(op: string, payload: unknown): string;
	awaitJob(jobId: string, timeoutMs?: number): unknown;
	awaitAll(jobIds: string[], timeoutMs?: number): { results: SettledReply[] };
	awaitAny(jobIds: string[], timeoutMs?: number): SettledReply;
	jobStatus(jobId: string): string;
	cancelJob(jobId: string): void;
	onSettled(handler: (msg: JobSettledMessage) => void): void;
	shutdown(): void;
}

export class WorkerJobsRuntime implements JobsRuntime {
	private worker: Worker | null = null;
	private settledHandler: ((msg: JobSettledMessage) => void) | undefined;

	constructor(
		private readonly workerUrl: URL,
		private readonly execArgv: string[] = [
			"--no-warnings",
			"--experimental-transform-types",
		],
	) {}

	private ensureWorker(): Worker {
		if (this.worker) return this.worker;
		this.worker = new Worker(this.workerUrl, { execArgv: this.execArgv });
		if (this.settledHandler) this.worker.on("message", this.settledHandler);
		this.worker.unref();
		return this.worker;
	}

	onSettled(handler: (msg: JobSettledMessage) => void): void {
		if (this.worker && this.settledHandler)
			this.worker.off("message", this.settledHandler);
		this.settledHandler = handler;
		if (this.worker) this.worker.on("message", handler);
	}

	call(op: string, payload: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): unknown {
		return this.request(op, payload, timeoutMs);
	}

	start(op: string, payload: unknown): string {
		const res = this.request("start", { op, payload }) as { jobId: string };
		return res.jobId;
	}

	awaitJob(jobId: string, timeoutMs = AWAIT_TIMEOUT_MS): unknown {
		return this.request("await", { jobId }, timeoutMs);
	}

	awaitAll(
		jobIds: string[],
		timeoutMs = AWAIT_TIMEOUT_MS,
	): { results: SettledReply[] } {
		return this.request("await-all", { jobIds }, timeoutMs) as {
			results: SettledReply[];
		};
	}

	awaitAny(jobIds: string[], timeoutMs = AWAIT_TIMEOUT_MS): SettledReply {
		return this.request("await-any", { jobIds }, timeoutMs) as SettledReply;
	}

	jobStatus(jobId: string): string {
		return (this.request("job-status", { jobId }) as { status: string }).status;
	}

	cancelJob(jobId: string): void {
		this.request("cancel", { jobId });
	}

	shutdown(): void {
		if (!this.worker) return;
		void this.worker.terminate();
		this.worker = null;
	}

	private request(
		op: string,
		payload: unknown,
		timeoutMs = DEFAULT_TIMEOUT_MS,
	): unknown {
		const w = this.ensureWorker();
		const ctrlSab = new SharedArrayBuffer(CTRL_BYTES);
		const dataSab = new SharedArrayBuffer(DATA_BYTES);
		const ctrl = new Int32Array(ctrlSab);
		Atomics.store(ctrl, 0, STATE_PENDING);
		const id = randomUUID();
		w.postMessage({ id, op, payload, ctrl: ctrlSab, data: dataSab });

		const waited = Atomics.wait(ctrl, 0, STATE_PENDING, timeoutMs);
		if (waited === "timed-out")
			throw new EvalException("async call timed out", op, false);

		const state = Atomics.load(ctrl, 0);
		const len = Atomics.load(ctrl, 1);
		let json: string;
		if (state === STATE_SPILL) {
			const path = new TextDecoder().decode(new Uint8Array(dataSab, 0, len));
			json = readFileSync(path, "utf8");
			try {
				unlinkSync(path);
			} catch {}
		} else {
			json = new TextDecoder().decode(new Uint8Array(dataSab, 0, len));
		}

		const parsed = JSON.parse(json) as unknown;
		if (state === STATE_ERROR) {
			const msg =
				parsed && typeof parsed === "object" && "error" in parsed
					? String((parsed as { error: unknown }).error)
					: json;
			throw new EvalException("job error", msg, false);
		}
		return parsed;
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
				return this.collect(job, runtime.awaitJob(job.jobId, timeout));
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
				const res = runtime.awaitAll(
					jobList.map((j) => j.jobId),
					parseTimeout(args[1]),
				);
				return arrayToList(
					res.results.map((r) => {
						const job = byId.get(r.jobId);
						if (!job)
							throw new EvalException("unknown job in await-all", r.jobId);
						if (!r.ok)
							return arrayToList([newLispKeyword("error"), r.e ?? "unknown"]);
						return this.collect(job, r.v);
					}),
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
				const r = runtime.awaitAny(
					jobList.map((j) => j.jobId),
					parseTimeout(args[1]),
				);
				const job = byId.get(r.jobId);
				if (!job) throw new EvalException("unknown job in await-any", r.jobId);
				return this.collectSettled(job, r);
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
