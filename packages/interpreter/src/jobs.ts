/*
 * Async-jobs runtime — the main-thread half of the async capability.
 *
 * The interpreter is fully synchronous; this layer lets it (a) make a blocking
 * call into async work and (b) start background jobs it can await, poll, or
 * cancel later. It is deliberately domain-agnostic: it knows nothing about MCP.
 * A consumer (see src/mcp.ts) supplies a `JobsRuntime` and a `toLisp` result
 * converter, then installs the generic job built-ins with `Jobs.installBuiltins`.
 *
 * `JobsRuntime` is the swappable transport. The bundled `WorkerJobsRuntime`
 * offloads work to a `worker_threads` worker over a SharedArrayBuffer bridge
 * (`Atomics.wait`/`notify`); a different backend (e.g. a Redis-backed worker
 * queue) can implement the same interface without touching the built-ins or the
 * domain layer. The wire protocol is in src/jobs-protocol.ts.
 */
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

export type { JobSettledMessage, SettledReply } from "./jobs-protocol.ts";

// The async capability behind the job built-ins. `call` runs a synchronous
// (blocking) op; `start` kicks off a background job whose id the rest operate
// on. Implement this to plug in a different backend (worker thread today, a
// distributed queue later).
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

// A `worker_threads`-backed JobsRuntime. The synchronous main thread posts a
// request and blocks on a SharedArrayBuffer via Atomics.wait; the worker (whose
// module URL is given here) performs the work and writes the reply back, then
// Atomics.notify wakes us. The worker itself runs the generic scheduler from
// src/jobs-broker.ts wrapped around a domain dispatch.
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
		// Keep the worker from holding the process open on its own.
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

	// Post a request to the worker and block until it replies (or times out).
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
			} catch {
				// best-effort cleanup
			}
		} else {
			json = new TextDecoder().decode(new Uint8Array(dataSab, 0, len));
		}

		const parsed = JSON.parse(json) as unknown;
		if (state === STATE_ERROR) {
			const msg =
				parsed && typeof parsed === "object" && "error" in parsed
					? String((parsed as { error: unknown }).error)
					: json;
			// Bind the handler variable (the EvalException value) to the actual
			// error text, so `(try … (catch (e) …))` gets something meaningful —
			// not `op`, an internal op-code like "call-tool" a catch couldn't act on.
			throw new EvalException("job error", msg, false);
		}
		return parsed;
	}
}

// A background-job handle. Carries the runtime jobId plus an optional
// main-thread finalizer that runs once when the job is first collected (e.g.
// installing an MCP server's tool bindings). Domain-agnostic: the finalizer is
// supplied by whoever starts the job.
export class Job {
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
}

const zJob = z.custom<Job>((x) => x instanceof Job, "job expected");

// Coerce a Lisp list of job handles into a Job[]; rejects non-jobs.
function toJobs(x: unknown): Job[] {
	const arr = x === null || x instanceof Cell ? listToArray(x as List) : [x];
	return arr.map((j) => {
		if (!(j instanceof Job)) throw new EvalException("not a job", j);
		return j;
	});
}

// Parse an optional `[timeout-ms]` await argument; absent -> AWAIT_TIMEOUT_MS.
// A non-finite value would make Atomics.wait block forever, so it is rejected.
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

// Owns a JobsRuntime plus the set of in-flight job handles, and installs the
// generic job built-ins (await, await-all, await-any, job-status, jobs, cancel).
// A consumer creates one, calls `installBuiltins`, and mints `Job`s with
// `runtime.start(...)` + `track(...)`.
export class Jobs {
	// In-flight job handles. A settled job is reaped when collected, so this (and
	// the onSettled iteration) stays bounded to jobs still running.
	readonly live = new Set<Job>();

	constructor(
		readonly runtime: JobsRuntime,
		// Convert a plain (JSON-ish) job result into a Lisp value, for jobs with no
		// finalizer of their own.
		private readonly toLisp: (raw: unknown) => unknown,
	) {
		// Apply `job-settled` push events: when a background job resolves, run its
		// finalizer as soon as the event loop turns — so a job's effect appears
		// automatically, without an explicit await. Idempotent with await via
		// job.finalized; errored jobs are left as-is.
		runtime.onSettled((msg) => {
			if (msg?.type !== "job-settled" || !msg.ok) return;
			for (const job of this.live) {
				if (job.jobId !== msg.jobId) continue;
				if (!job.finalized) {
					try {
						this.collect(job, msg.v);
					} catch {
						// Finalizer failed (e.g. server vanished): leave it uncollected.
					}
				}
				return;
			}
		});
	}

	// Start tracking a freshly-minted job handle.
	track(job: Job): Job {
		this.live.add(job);
		return job;
	}

	// Collect a job's result on the main thread: run its finalizer once (caching
	// the result) so repeated awaits are idempotent, or convert a plain result to
	// Lisp. Reaps the handle from `live` once collected.
	collect(job: Job, raw: unknown): unknown {
		if (job.finalized) return job.cached;
		const value = job.finalize ? job.finalize(raw) : this.toLisp(raw);
		job.finalized = true;
		job.cached = value;
		this.live.delete(job);
		return value;
	}

	// Turn a runtime SettledReply into the collected Lisp value, throwing on error.
	private collectSettled(job: Job, r: SettledReply): unknown {
		// Bind the handler variable to the actual error text (matching `(:error msg)`
		// in await-all and the request() error path) — not `job.label`, which a
		// `catch` couldn't act on.
		if (!r.ok) throw new EvalException("job error", r.e ?? "unknown", false);
		return this.collect(job, r.v);
	}

	// Discard all in-flight handles and shut the runtime down.
	shutdown(): void {
		this.live.clear();
		this.runtime.shutdown();
	}

	installBuiltins(interp: Interp): void {
		const { runtime } = this;

		// (await job [timeout-ms]) -> the job's result (blocks until it settles).
		// A finalizing job (e.g. load-mcp) applies its effect here. Idempotent; on
		// timeout it raises but leaves the job awaitable.
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
				// Validate the timeout before short-circuiting so an invalid timeout is
				// rejected regardless of whether the job has already finalized.
				const timeout = parseTimeout(args[1]);
				if (job.finalized) return job.cached;
				return this.collect(job, runtime.awaitJob(job.jobId, timeout));
			},
		);

		// (await-all (list job ...) [timeout-ms]) -> list of results, input order.
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
				// A failed job collects to (:error "message") in place, so it never
				// discards its succeeded siblings.
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

		// (await-any (list job ...) [timeout-ms]) -> the first result to settle.
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

		// (job-status job) -> :pending | :done | :error
		interp.def(
			"job-status",
			1,
			"(job-status job)",
			"Return the status of an async job as a keyword: :pending, :done, or :error.",
			z.tuple([zJob]),
			([job]) =>
				newLispKeyword(job.finalized ? "done" : runtime.jobStatus(job.jobId)),
		);

		// (jobs) -> ((job :status) ...) for every in-flight job. Settled jobs are
		// reaped when collected, so they do not appear here.
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

		// (cancel job) -> t ; abort and stop tracking the job (best-effort).
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
