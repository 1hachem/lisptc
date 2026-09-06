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

export type DomainDispatch<Op extends string = string> = (
	op: Op,
	payload: unknown,
	signal?: AbortSignal,
) => Promise<unknown>;

const errMsg = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

type Settled = { ok: true; v: unknown } | { ok: false; e: string };

interface JobRec {
	promise: Promise<unknown>;
	controller: AbortController;
	state: "pending" | "done" | "error";
}

const META_OPS = new Set([
	"start",
	"await",
	"job-status",
	"cancel",
	"await-all",
	"await-any",
]);

export function runWorker<Op extends string>(
	dispatch: DomainDispatch<Op>,
): void {
	if (!parentPort) throw new Error("jobs-broker must run as a worker thread");
	const port = parentPort;
	const jobs = new Map<string, JobRec>();

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

	function settleJob(jobId: string, settled: Settled): void {
		if (!jobs.has(jobId)) return;
		port.postMessage({ type: "job-settled", jobId, ...settled });
	}

	function startJob(op: string, payload: unknown): string {
		const jobId = randomUUID();
		const controller = new AbortController();
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

	function awaitJob(jobId: string): Promise<unknown> {
		const rec = jobs.get(jobId);
		if (!rec) throw new Error(`no such job: ${jobId}`);
		return rec.promise;
	}

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
				const { jobId } = payload as { jobId: string };
				jobs.get(jobId)?.controller.abort();
				jobs.delete(jobId);
				return { ok: true };
			}
			case "await-all": {
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

function reply(req: WorkerRequest, state: number, json: string): void {
	const ctrl = new Int32Array(req.ctrl);
	const bytes = new TextEncoder().encode(json);
	const dataView = new Uint8Array(req.data);

	if (bytes.byteLength <= dataView.byteLength) {
		dataView.set(bytes);
		Atomics.store(ctrl, 1, bytes.byteLength);
		Atomics.store(ctrl, 0, state);
	} else {
		const path = join(tmpdir(), `lisptc-job-${req.id}.json`);
		writeFileSync(path, json, "utf8");
		const pathBytes = new TextEncoder().encode(path);
		dataView.set(pathBytes);
		Atomics.store(ctrl, 1, pathBytes.byteLength);
		Atomics.store(ctrl, 0, state === STATE_ERROR ? STATE_ERROR : STATE_SPILL);
	}
	Atomics.notify(ctrl, 0);
}
