/*
 * WorkerBridge — the default SyncBridge runtime.
 *
 * A single Node thread cannot block on its own event loop without
 * deadlocking, so all async MCP work happens in a worker_threads broker
 * (src/mcp/broker.ts) with its own event loop. Each request gets its own
 * ctrl/data SharedArrayBuffer pair, so any number of requests can be in
 * flight at once; posting and waiting are independent, which is what powers
 * the :async tool calls. `Atomics.wait` blocks the main thread until the
 * broker stores a terminal state and notifies.
 *
 * Note: the worker is unref()ed so it never holds the process open — a
 * posted-but-never-awaited ticket dies with the process.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { EvalException } from "../../exceptions.ts";
import type { McpTicket, SyncBridge, TicketState } from "../bridge.ts";
import {
	CTRL_BYTES,
	CTRL_LENGTH,
	CTRL_SPILLED,
	CTRL_STATE,
	DATA_BYTES,
	type Op,
	STATE_ERROR,
	STATE_PENDING,
} from "../protocol.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

class WorkerTicket implements McpTicket {
	// Memoized outcome so a second wait() returns the same result.
	settled = false;
	result: unknown;
	error: string | null = null;

	constructor(
		readonly id: string,
		readonly op: Op,
		readonly ctrl: Int32Array,
		readonly data: SharedArrayBuffer,
	) {}
}

export class WorkerBridge implements SyncBridge {
	private worker: Worker | null = null;

	constructor(
		private readonly workerUrl: URL = new URL("../broker.ts", import.meta.url),
	) {}

	private ensureWorker(): Worker {
		if (this.worker) return this.worker;
		this.worker = new Worker(this.workerUrl, {
			execArgv: ["--no-warnings", "--experimental-transform-types"],
		});
		// Keep the worker from holding the process open on its own.
		this.worker.unref();
		return this.worker;
	}

	request(op: Op, payload: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): unknown {
		return this.wait(this.post(op, payload), timeoutMs);
	}

	post(op: Op, payload: unknown): WorkerTicket {
		const w = this.ensureWorker();
		const ctrlSab = new SharedArrayBuffer(CTRL_BYTES);
		const dataSab = new SharedArrayBuffer(DATA_BYTES);
		const ctrl = new Int32Array(ctrlSab);
		Atomics.store(ctrl, CTRL_STATE, STATE_PENDING);
		const id = randomUUID();
		w.postMessage({ id, op, payload, ctrl: ctrlSab, data: dataSab });
		return new WorkerTicket(id, op, ctrl, dataSab);
	}

	wait(ticket: McpTicket, timeoutMs = DEFAULT_TIMEOUT_MS): unknown {
		const t = this.ownTicket(ticket);
		if (!t.settled) {
			const waited = Atomics.wait(t.ctrl, CTRL_STATE, STATE_PENDING, timeoutMs);
			if (waited === "timed-out")
				throw new EvalException("MCP call timed out", t.op, false);
			this.settle(t);
		}
		if (t.error !== null)
			throw new EvalException(`MCP error: ${t.error}`, t.op, false);
		return t.result;
	}

	poll(ticket: McpTicket): TicketState {
		const t = this.ownTicket(ticket);
		if (!t.settled && Atomics.load(t.ctrl, CTRL_STATE) === STATE_PENDING)
			return "pending";
		if (!t.settled) this.settle(t);
		return t.error !== null ? "error" : "done";
	}

	shutdown(): void {
		if (this.worker) {
			void this.worker.terminate();
			this.worker = null;
		}
	}

	// Decode the completed reply into the ticket's memoized outcome.
	private settle(t: WorkerTicket): void {
		const state = Atomics.load(t.ctrl, CTRL_STATE);
		const len = Atomics.load(t.ctrl, CTRL_LENGTH);
		const spilled = Atomics.load(t.ctrl, CTRL_SPILLED) !== 0;
		let json: string;
		if (spilled) {
			const path = new TextDecoder().decode(new Uint8Array(t.data, 0, len));
			json = readFileSync(path, "utf8");
			try {
				unlinkSync(path);
			} catch {
				// best-effort cleanup
			}
		} else {
			json = new TextDecoder().decode(new Uint8Array(t.data, 0, len));
		}
		const parsed = JSON.parse(json) as unknown;
		if (state === STATE_ERROR) {
			t.error =
				parsed && typeof parsed === "object" && "error" in parsed
					? String((parsed as { error: unknown }).error)
					: json;
		} else {
			t.result = parsed;
		}
		t.settled = true;
	}

	private ownTicket(ticket: McpTicket): WorkerTicket {
		if (ticket instanceof WorkerTicket) return ticket;
		throw new EvalException("foreign MCP ticket", ticket.id, false);
	}
}
