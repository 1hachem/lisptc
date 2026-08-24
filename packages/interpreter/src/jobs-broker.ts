/*
 * Generic async-jobs scheduler — the worker-thread half of the jobs runtime.
 *
 * A concrete worker (e.g. src/mcp-broker.ts) supplies a `dispatch(op, payload,
 * signal)` that performs one domain operation, then calls `runWorker(dispatch)`.
 * This module owns everything domain-agnostic: the SharedArrayBuffer reply
 * bridge, and the background-job scheduler with its meta-ops:
 *
 *   start       kick off `dispatch(innerOp, innerPayload, signal)` as a
 *               background job; reply with its jobId immediately.
 *   await       block on one job's promise; reply with its result (or error).
 *   await-all   Promise.allSettled over several jobs, in input order.
 *   await-any   Promise.race over several jobs (first to settle wins).
 *   job-status  a synchronously-readable pending|done|error snapshot.
 *   cancel      abort the job's in-flight request (AbortController) and drop it.
 *
 * Every other op is forwarded to the domain `dispatch` synchronously (blocking
 * call, no job). When a job settles it also posts a `job-settled` event so the
 * main thread can finalize it between evals without an explicit await.
 *
 * The reply protocol (states, sizes) lives in src/jobs-protocol.ts.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parentPort } from "node:worker_threads";
import {
	STATE_DONE,
	STATE_ERROR,
	STATE_SPILL,
	type WorkerRequest,
} from "./jobs-protocol.ts";

// Performs one domain operation. `signal` is present only for ops run as a
// background job (via `start`), so a long-running op can honor cancellation.
// `Op` is the domain's own op union (e.g. mcp-broker's McpOp), so its dispatch
// keeps a typed, exhaustively-checked switch; the scheduler does the single cast
// from the raw wire string at the boundary below.
export type DomainDispatch<Op extends string = string> = (
	op: Op,
	payload: unknown,
	signal?: AbortSignal,
) => Promise<unknown>;

const errMsg = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// A settled job outcome, tagged so success/failure isn't re-derived downstream.
type Settled = { ok: true; v: unknown } | { ok: false; e: string };

// Background jobs keyed by the jobId `start` mints: the native `promise`, a
// per-job `AbortController` (wired into the domain op's signal), and a
// synchronously-readable `state` snapshot for `job-status`.
interface JobRec {
	promise: Promise<unknown>;
	controller: AbortController;
	state: "pending" | "done" | "error";
}

// Meta-ops handled by the scheduler itself rather than the domain dispatch.
const META_OPS = new Set([
	"start",
	"await",
	"job-status",
	"cancel",
	"await-all",
	"await-any",
]);

// Wire the domain dispatch to the parent port. Call once, at worker startup.
export function runWorker<Op extends string>(
	dispatch: DomainDispatch<Op>,
): void {
	if (!parentPort) throw new Error("jobs-broker must run as a worker thread");
	const port = parentPort;
	const jobs = new Map<string, JobRec>();

	// Tag a job's native promise as a never-rejecting Settled outcome, so a
	// failing job doesn't reject a combinator (await-all / await-any).
	const tagged = (jobId: string): Promise<Settled & { jobId: string }> => {
		const rec = jobs.get(jobId);
		const p = rec
			? rec.promise
			: Promise.reject(new Error(`no such job: ${jobId}`));
		return p.then(
			(v) => ({ jobId, ok: true as const, v }),
			(e) => ({ jobId, ok: false as const, e: errMsg(e) }),
		);
	};

	// Push a completion event so the main thread can finalize the job once its
	// event loop turns. Skipped if the job was cancelled (dropped from `jobs`).
	function settleJob(jobId: string, settled: Settled): void {
		if (!jobs.has(jobId)) return;
		port.postMessage({ type: "job-settled", jobId, ...settled });
	}

	// Register `dispatch(op, payload, signal)` as a background job and return its
	// id at once (the promise is not awaited here). The `.then` tracks state,
	// pushes a `job-settled` event, and absorbs rejections so a never-awaited
	// failure never becomes an unhandledRejection.
	function startJob(op: string, payload: unknown): string {
		const jobId = randomUUID();
		const controller = new AbortController();
		// `op` is a raw wire string; trust it as a domain op (an unknown one hits
		// the domain dispatch's `default` and throws).
		const promise = dispatch(op as Op, payload, controller.signal);
		const rec: JobRec = { promise, controller, state: "pending" };
		jobs.set(jobId, rec);
		promise.then(
			(v) => {
				rec.state = "done";
				settleJob(jobId, { ok: true, v });
			},
			(e) => {
				rec.state = "error";
				settleJob(jobId, { ok: false, e: errMsg(e) });
			},
		);
		return jobId;
	}

	// Await one job's native result, re-throwing its error so `handle()` turns it
	// into a STATE_ERROR reply. Unknown ids are treated as an error.
	function awaitJob(jobId: string): Promise<unknown> {
		const rec = jobs.get(jobId);
		if (!rec) throw new Error(`no such job: ${jobId}`);
		return rec.promise;
	}

	// Handle a meta-op, or forward everything else to the domain dispatch.
	async function metaDispatch(op: string, payload: unknown): Promise<unknown> {
		switch (op) {
			case "start": {
				const { op: innerOp, payload: innerPayload } = payload as {
					op: string;
					payload: unknown;
				};
				return { jobId: startJob(innerOp, innerPayload) };
			}
			case "await":
				return awaitJob((payload as { jobId: string }).jobId);
			case "job-status": {
				const rec = jobs.get((payload as { jobId: string }).jobId);
				return { status: rec ? rec.state : "unknown" };
			}
			case "cancel": {
				// Real cancellation via AbortController: abort the in-flight request
				// (the domain op's signal), then stop tracking the job.
				const { jobId } = payload as { jobId: string };
				jobs.get(jobId)?.controller.abort();
				jobs.delete(jobId);
				return { ok: true };
			}
			case "await-all": {
				// Promise.allSettled: collect every job's outcome, in input order,
				// without one failure rejecting the batch.
				const ids = (payload as { jobIds: string[] }).jobIds;
				const settled = await Promise.allSettled(
					ids.map((id) => Promise.resolve().then(() => awaitJob(id))),
				);
				return {
					results: ids.map((jobId, i) => {
						const s = settled[i];
						return s.status === "fulfilled"
							? { jobId, ok: true, v: s.value }
							: { jobId, ok: false, e: errMsg(s.reason) };
					}),
				};
			}
			case "await-any": {
				// Promise.race over never-rejecting tagged outcomes: the first job to
				// settle (success OR failure) wins.
				const ids = (payload as { jobIds: string[] }).jobIds;
				if (ids.length === 0) throw new Error("await-any: no jobs");
				return Promise.race(ids.map(tagged));
			}
			default:
				return dispatch(op as Op, payload);
		}
	}

	async function handle(req: WorkerRequest): Promise<void> {
		try {
			const result = META_OPS.has(req.op)
				? await metaDispatch(req.op, req.payload)
				: await dispatch(req.op as Op, req.payload);
			reply(req, STATE_DONE, JSON.stringify(result ?? null));
		} catch (ex) {
			reply(req, STATE_ERROR, JSON.stringify({ error: errMsg(ex) }));
		}
	}

	port.on("message", (req: WorkerRequest) => {
		void handle(req);
	});
}

// Write the JSON reply into shared memory (or spill a large reply to a temp
// file), then wake the blocked main thread.
function reply(req: WorkerRequest, state: number, json: string): void {
	const ctrl = new Int32Array(req.ctrl);
	const bytes = new TextEncoder().encode(json);
	const dataView = new Uint8Array(req.data);

	if (bytes.byteLength <= dataView.byteLength) {
		dataView.set(bytes);
		Atomics.store(ctrl, 1, bytes.byteLength);
		Atomics.store(ctrl, 0, state);
	} else {
		// Too large for the shared buffer: spill to a temp file and hand back
		// its path (length field is repurposed as the path byte length).
		const path = join(tmpdir(), `lisptc-job-${req.id}.json`);
		writeFileSync(path, json, "utf8");
		const pathBytes = new TextEncoder().encode(path);
		dataView.set(pathBytes);
		Atomics.store(ctrl, 1, pathBytes.byteLength);
		Atomics.store(ctrl, 0, state === STATE_ERROR ? STATE_ERROR : STATE_SPILL);
	}
	Atomics.notify(ctrl, 0);
}
