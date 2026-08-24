/*
 * Wire protocol shared by the async-jobs runtime (main thread, src/jobs.ts) and
 * the worker-side scheduler (src/jobs-broker.ts).
 *
 * The interpreter is fully synchronous; async work runs on another thread. The
 * main thread posts a request and blocks on a `SharedArrayBuffer` via
 * `Atomics.wait`; the worker writes the reply back into shared memory and calls
 * `Atomics.notify`. This module is the single source of truth for the reply
 * states, buffer sizes, timeouts, and message shapes — kept import-free (no
 * runtime deps) so the worker can use it without dragging in the interpreter.
 */

// Reply states written into ctrl[0].
export const STATE_PENDING = 0;
export const STATE_DONE = 1;
export const STATE_ERROR = 2;
// Reply too big for the inline `data` buffer; ctrl[1] names a temp file instead.
export const STATE_SPILL = 3;

export const CTRL_BYTES = 8; // Int32Array [state, length]
export const DATA_BYTES = 1 << 20; // 1 MiB inline reply buffer

// Per-request blocking-call timeout (a synchronous op or a job meta-op).
export const DEFAULT_TIMEOUT_MS = 30_000;
// How long `(await …)` blocks before giving up.
export const AWAIT_TIMEOUT_MS = 50_000;

// One request from the main thread to the worker.
export interface WorkerRequest {
	id: string;
	op: string;
	payload: unknown;
	ctrl: SharedArrayBuffer;
	data: SharedArrayBuffer;
}

// A settled job outcome as reported by await-all / await-any.
export type SettledReply = {
	jobId: string;
	ok: boolean;
	v?: unknown;
	e?: string;
};

// The `job-settled` push event the worker posts (outside the SAB reply path)
// when a background job resolves, so the main thread can finalize it as soon as
// its event loop turns — without an explicit await.
export type JobSettledMessage = {
	type?: string;
	jobId?: string;
	ok?: boolean;
	v?: unknown;
};
