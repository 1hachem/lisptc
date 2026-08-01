/*
 * MCP broker — runs inside a worker_threads Worker.
 *
 * The Lisp interpreter (src/lisp.ts) is fully synchronous; MCP is async. A
 * single Node thread cannot block on its own event loop without deadlocking,
 * so all async MCP work happens here, on a separate thread with its own event
 * loop. The main thread posts a request and blocks on a SharedArrayBuffer via
 * Atomics.wait (see src/mcp.ts); this worker performs the SDK call and writes
 * the result back into shared memory, then Atomics.notify wakes the main
 * thread.
 *
 * Protocol (per request):
 *   main -> worker : postMessage({ id, op, payload, ctrl, data })
 *                    ctrl  = Int32Array-backed SharedArrayBuffer [state, length]
 *                    data  = SharedArrayBuffer for the UTF-8 JSON reply
 *   worker -> main : write reply bytes into `data` (or spill to a temp file),
 *                    Atomics.store(ctrl, 0, DONE|SPILL|ERROR),
 *                    Atomics.store(ctrl, 1, byteLength),
 *                    Atomics.notify(ctrl, 0)
 *
 * All MCP typing comes from the official SDK — no hand-rolled JSON-RPC.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parentPort } from "node:worker_threads";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// Reply states written into ctrl[0]. Must match src/mcp.ts.
const STATE_DONE = 1;
const STATE_ERROR = 2;
const STATE_SPILL = 3; // reply too big for `data`; ctrl-length names a temp file

// A connection descriptor sent by the main thread.
type ConnConfig =
	| { name: string; url: string; headers?: Record<string, string> }
	| {
			name: string;
			command: string;
			args?: string[];
			env?: Record<string, string>;
	  };

type Op =
	| "connect"
	| "list-tools"
	| "call-tool"
	| "disconnect"
	| "search"
	// Async job meta-ops: `start` kicks off any inner op as a background job and
	// returns its id immediately; the rest collect/inspect that job later.
	| "start"
	| "await"
	| "job-status"
	| "cancel"
	| "await-all"
	| "await-any";

interface Request {
	id: string;
	op: Op;
	payload: unknown;
	ctrl: SharedArrayBuffer;
	data: SharedArrayBuffer;
}

// Live MCP clients keyed by the serverId the broker mints on connect.
const clients = new Map<string, { client: Client; tools: Tool[] }>();

const errMsg = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// A settled job outcome, tagged so it can be sent to the main thread and used
// by the aggregate awaits without either side re-deriving success/failure.
type Settled = { ok: true; v: unknown } | { ok: false; e: string };

// Background jobs keyed by the jobId `start` mints. We hold the native operation
// `promise` and a per-job `AbortController` (the standard cancellation
// primitive, wired into the MCP SDK's RequestOptions.signal); `state` is a
// synchronously-readable snapshot for `job-status`.
interface JobRec {
	promise: Promise<unknown>;
	controller: AbortController;
	state: "pending" | "done" | "error";
}
const jobs = new Map<string, JobRec>();

// Tag a job's native promise as a never-rejecting Settled outcome. Used by the
// aggregate awaits so a failing job doesn't reject the whole combinator.
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

// Register `dispatch(op, payload, signal)` as a background job and return its
// id. The native promise is attached now but NOT awaited, so `start` can reply
// immediately. A single `.then` tracks state, PUSHes a `job-settled` event to
// the main thread (so the result applies as soon as its event loop turns), and
// doubles as the rejection handler so a never-awaited failure never becomes an
// unhandledRejection.
function startJob(op: Op, payload: unknown): string {
	const jobId = randomUUID();
	const controller = new AbortController();
	const promise = dispatch(op, payload, controller.signal);
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

// Push a completion event to the main thread so it can apply the result (e.g.
// install a server's tools) as soon as its event loop next turns — the
// event-driven counterpart to `await`. Skipped if the job was cancelled.
function settleJob(jobId: string, settled: Settled): void {
	if (!jobs.has(jobId)) return;
	port.postMessage({ type: "job-settled", jobId, ...settled });
}

// Await one job's native result, re-throwing its error so `handle()` turns it
// into a STATE_ERROR reply. Unknown ids are treated as an error.
function awaitJob(jobId: string): Promise<unknown> {
	const rec = jobs.get(jobId);
	if (!rec) throw new Error(`no such job: ${jobId}`);
	return rec.promise;
}

if (!parentPort) throw new Error("mcp-broker must run as a worker thread");
const port = parentPort;

port.on("message", (req: Request) => {
	void handle(req);
});

async function handle(req: Request): Promise<void> {
	try {
		const result = await dispatch(req.op, req.payload);
		reply(req, STATE_DONE, JSON.stringify(result ?? null));
	} catch (ex) {
		const message = ex instanceof Error ? ex.message : String(ex);
		reply(req, STATE_ERROR, JSON.stringify({ error: message }));
	}
}

async function dispatch(
	op: Op,
	payload: unknown,
	signal?: AbortSignal,
): Promise<unknown> {
	switch (op) {
		case "connect":
			return connect(payload as ConnConfig, signal);
		case "list-tools":
			return listTools((payload as { serverId: string }).serverId);
		case "call-tool":
			return callTool(
				payload as {
					serverId: string;
					tool: string;
					args: Record<string, unknown>;
				},
				signal,
			);
		case "disconnect":
			return disconnect((payload as { serverId: string }).serverId);
		case "search":
			// v2 semantic search backend hook — reserved. See src/mcp.ts search-tools.
			throw new Error("semantic search backend not implemented");
		case "start": {
			const { op: innerOp, payload: innerPayload } = payload as {
				op: Op;
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
			// Real cancellation via AbortController: abort the in-flight SDK
			// request (RequestOptions.signal), then stop tracking the job.
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
			throw new Error(`unknown op: ${op}`);
	}
}

async function connect(
	conf: ConnConfig,
	signal?: AbortSignal,
): Promise<{ serverId: string; tools: Tool[] }> {
	const transport =
		"url" in conf
			? new StreamableHTTPClientTransport(new URL(conf.url), {
					requestInit: conf.headers ? { headers: conf.headers } : undefined,
				})
			: new StdioClientTransport({
					command: conf.command,
					args: conf.args ?? [],
					// Inherit env so PATH etc. resolve; merge any explicit overrides.
					env: {
						...(process.env as Record<string, string>),
						...(conf.env ?? {}),
					},
				});

	const client = new Client(
		{ name: "lisptc", version: "1.0.0" },
		{ capabilities: {} },
	);
	// SDK performs the initialize + notifications/initialized handshake. The
	// AbortSignal (from the job's AbortController) lets (cancel job) abort a
	// slow connect/list mid-flight.
	await client.connect(transport, { signal });
	const { tools } = await client.listTools(undefined, { signal });
	// A server that handshakes but exposes no tools is useless to lisptc (whose
	// MCP integration is tools-only) — this is the common shape of a degraded /
	// unauthenticated / wrong-URL connection, which returns an empty list rather
	// than erroring. Treat it as a load failure so it surfaces as :error instead
	// of a misleading :loaded server with no tools.
	if (tools.length === 0) {
		await client.close().catch(() => {});
		throw new Error("connected but the server exposed no tools");
	}
	const serverId = randomUUID();
	clients.set(serverId, { client, tools });
	return { serverId, tools };
}

async function listTools(serverId: string): Promise<Tool[]> {
	const entry = clients.get(serverId);
	if (!entry) throw new Error(`no such server: ${serverId}`);
	const { tools } = await entry.client.listTools();
	entry.tools = tools;
	return tools;
}

async function callTool(
	payload: {
		serverId: string;
		tool: string;
		args: Record<string, unknown>;
	},
	signal?: AbortSignal,
): Promise<unknown> {
	const entry = clients.get(payload.serverId);
	if (!entry) throw new Error(`no such server: ${payload.serverId}`);
	const result = await entry.client.callTool(
		{ name: payload.tool, arguments: payload.args },
		undefined,
		{ signal },
	);
	if (result.isError) {
		const text = extractText(result.content);
		throw new Error(text || `tool ${payload.tool} returned an error`);
	}
	// Prefer structured output when present. Otherwise, collapse an all-text
	// content array to a plain string (the common case), else return it raw.
	if (result.structuredContent !== undefined) return result.structuredContent;
	const content = result.content;
	if (
		Array.isArray(content) &&
		content.length > 0 &&
		content.every((c) => c?.type === "text")
	) {
		return content.map((c) => (c as { text: string }).text).join("\n");
	}
	return content ?? null;
}

async function disconnect(serverId: string): Promise<{ ok: true }> {
	const entry = clients.get(serverId);
	if (!entry) throw new Error(`no such server: ${serverId}`);
	await entry.client.close();
	clients.delete(serverId);
	return { ok: true };
}

// Concatenate the text parts of a CallToolResult content array (for errors).
function extractText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((c): c is { type: "text"; text: string } => c?.type === "text")
		.map((c) => c.text)
		.join("\n");
}

// Write the JSON reply into shared memory (or spill a large reply to a temp
// file), then wake the blocked main thread.
function reply(req: Request, state: number, json: string): void {
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
		const path = join(tmpdir(), `lisptc-mcp-${req.id}.json`);
		writeFileSync(path, json, "utf8");
		const pathBytes = new TextEncoder().encode(path);
		dataView.set(pathBytes);
		Atomics.store(ctrl, 1, pathBytes.byteLength);
		Atomics.store(ctrl, 0, state === STATE_ERROR ? STATE_ERROR : STATE_SPILL);
	}
	Atomics.notify(ctrl, 0);
}
