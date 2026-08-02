/*
 * MCP integration for Lisptc (main-thread side).
 *
 * Installs the load-mcp / unload-mcp / list-mcps / list-toolkit / list-tools / mcp-doc /
 * search-tools / search-mcps / mcp-shutdown built-ins into an Interp. All async MCP work is
 * delegated to a worker_threads broker (src/mcp-broker.ts); the synchronous
 * interpreter blocks on it through a SharedArrayBuffer + Atomics.wait bridge,
 * which is the only way to call async code from Node's synchronous main thread
 * without deadlocking its event loop.
 *
 * Loaded tools become ordinary global bindings named "<server>/<tool>", called
 * with native keyword syntax, e.g. (linear/list-issues :query "auth bug").
 */
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { z } from "zod";
import { isNumeric } from "./arith.ts";
import {
	Cell,
	EvalException,
	type Interp,
	LispKeyword,
	type List,
	newLispKeyword,
	newSym,
	Secret,
	Sym,
	zList,
} from "./lisp.ts";

// A tool/server name argument: a string, symbol or keyword, coerced to string.
const zName = z
	.custom<string | Sym | LispKeyword>(
		(x) =>
			typeof x === "string" || x instanceof Sym || x instanceof LispKeyword,
		"string or symbol expected",
	)
	.transform((x) => asName(x));

// --- Broker reply protocol (must match src/mcp-broker.ts) --------------------
const STATE_PENDING = 0;
// STATE_DONE = 1 is implicit: any non-PENDING, non-ERROR, non-SPILL state.
const STATE_ERROR = 2;
const STATE_SPILL = 3;

const CTRL_BYTES = 8; // Int32Array [state, length]
const DATA_BYTES = 1 << 20; // 1 MiB inline reply buffer
const DEFAULT_TIMEOUT_MS = 30_000;
// How long (await …) blocks before giving up.
const AWAIT_TIMEOUT_MS = 50_000;

// --- Types -------------------------------------------------------------------
interface Tool {
	name: string;
	description?: string;
	inputSchema?: JsonSchema;
}

interface JsonSchema {
	type?: string;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	enum?: unknown[];
	description?: string;
}

type ConnConfig = { description?: string } & (
	| {
			name: string;
			url: string;
			headers?: Record<string, string>;
			// OAuth 2.1 servers (e.g. Linear); `scopes` are requested at auth time.
			// See devdocs/oauth.md.
			oauth?: boolean;
			scopes?: string[];
	  }
	| {
			name: string;
			command: string;
			args?: string[];
			env?: Record<string, string>;
	  }
);

interface ServerRec {
	name: string;
	serverId: string;
	toolSyms: Sym[];
	tools: Map<string, Tool>;
}

// An async job handle returned by lifecycle ops like load-mcp. Carries the
// broker jobId plus an optional main-thread finalizer that runs once when the
// job is first collected (e.g. installing a server's tool bindings).
class Job {
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

// A job handle argument.
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

// --- Module state ------------------------------------------------------------
const servers = new Map<string, ServerRec>();
const predefined = new Map<string, ConnConfig>();
// Jobs the interpreter still holds a handle to; used by (jobs) and cleared on
// shutdown. Broker-side job state lives in the worker and dies with it.
const liveJobs = new Set<Job>();
let worker: Worker | null = null;

// --- The synchronous bridge --------------------------------------------------
function ensureWorker(): Worker {
	if (worker) return worker;
	worker = new Worker(new URL("./mcp-broker.ts", import.meta.url), {
		execArgv: ["--no-warnings", "--experimental-transform-types"],
	});
	// Apply `job-settled` push events: when a background job resolves, the broker
	// posts here and we run its finalizer (e.g. install a server's tools) as soon
	// as the event loop turns — so a loaded server's tools appear automatically,
	// without an explicit (await job). Idempotent with await via job.finalized.
	worker.on("message", onJobSettled);
	// Keep the worker from holding the process open on its own.
	worker.unref();
	return worker;
}

// Post a request to the broker and block until it replies (or times out).
function mcpRequest(
	op: string,
	payload: unknown,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): unknown {
	const w = ensureWorker();
	const ctrlSab = new SharedArrayBuffer(CTRL_BYTES);
	const dataSab = new SharedArrayBuffer(DATA_BYTES);
	const ctrl = new Int32Array(ctrlSab);
	Atomics.store(ctrl, 0, STATE_PENDING);
	const id = randomUUID();
	w.postMessage({ id, op, payload, ctrl: ctrlSab, data: dataSab });

	const waited = Atomics.wait(ctrl, 0, STATE_PENDING, timeoutMs);
	if (waited === "timed-out")
		throw new EvalException("MCP call timed out", op, false);

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
		throw new EvalException(`MCP error: ${msg}`, op, false);
	}
	return parsed;
}

// --- Async job bridge --------------------------------------------------------
// Kick off `op` as a background job in the broker; returns its jobId at once.
function mcpStart(op: string, payload: unknown): string {
	const res = mcpRequest("start", { op, payload }) as { jobId: string };
	return res.jobId;
}

// Block until the job settles (or times out); returns its raw result or throws.
function mcpAwait(jobId: string, timeoutMs = AWAIT_TIMEOUT_MS): unknown {
	return mcpRequest("await", { jobId }, timeoutMs);
}

// Non-blocking status snapshot: "pending" | "done" | "error" | "unknown".
function mcpStatus(jobId: string): string {
	return (mcpRequest("job-status", { jobId }) as { status: string }).status;
}

// A settled job result as reported by await-all / await-any.
type SettledReply = { jobId: string; ok: boolean; v?: unknown; e?: string };

// Collect a job on the main thread: run its finalizer once (caching the result)
// so repeated awaits are idempotent, or translate a plain result to Lisp.
function collect(job: Job, raw: unknown): unknown {
	if (job.finalized) return job.cached;
	const value = job.finalize ? job.finalize(raw) : jsonToLisp(raw);
	job.finalized = true;
	job.cached = value;
	return value;
}

// Turn a broker SettledReply into the collected Lisp value, throwing on error.
function collectSettled(job: Job, r: SettledReply): unknown {
	if (!r.ok) throw new EvalException(`MCP error: ${r.e}`, job.label, false);
	return collect(job, r.v);
}

// Handle a `job-settled` push from the broker: apply the job's finalizer (e.g.
// install a server's tools) once the event loop turns, so a load lands without
// an explicit await. Idempotent; errored jobs are left as-is.
function onJobSettled(msg: {
	type?: string;
	jobId?: string;
	ok?: boolean;
	v?: unknown;
}): void {
	if (msg?.type !== "job-settled" || !msg.ok) return;
	for (const job of liveJobs) {
		if (job.jobId !== msg.jobId) continue;
		if (!job.finalized) {
			try {
				collect(job, msg.v);
			} catch {
				// Finalizer failed (e.g. server vanished): leave it uninstalled.
			}
		}
		return;
	}
}

// --- Lisp <-> JS/JSON conversion ---------------------------------------------
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

// Parse a keyword plist (:k1 v1 :k2 v2 ...) into a Map of name -> raw Lisp value.
function parsePlist(list: List): Map<string, unknown> {
	const out = new Map<string, unknown>();
	let j = list;
	while (j !== null) {
		const key = j.car;
		const rest = j.cdr as List;
		if (rest === null)
			throw new EvalException(
				"odd-length keyword list; missing value for",
				key,
			);
		const name = keyName(key);
		out.set(name, rest.car);
		j = rest.cdr as List;
	}
	return out;
}

// Extract the string name from a :keyword, symbol, or string key.
function keyName(key: unknown): string {
	if (key instanceof LispKeyword) return key.name;
	if (key instanceof Sym) return key.name;
	if (typeof key === "string") return key;
	throw new EvalException("keyword expected as key", key);
}

// Detect an alist: a proper list whose every element is a (key . value) pair.
function isAlist(x: Cell): boolean {
	for (let j: List = x; j !== null; j = j.cdr as List) {
		const e = j.car;
		if (!(e instanceof Cell)) return false;
		const k = e.car;
		if (
			!(k instanceof Sym || k instanceof LispKeyword || typeof k === "string")
		)
			return false;
	}
	return true;
}

function lispToJson(x: unknown): unknown {
	if (x === null) return null;
	if (x === true) return true;
	if (typeof x === "string") return x;
	if (typeof x === "bigint") return Number(x);
	if (isNumeric(x)) return x;
	if (x instanceof LispKeyword) return x.name;
	if (x instanceof Sym) return x.name;
	// A secret reveals its value only here, into the outgoing MCP request.
	if (x instanceof Secret) return x.value;
	if (x instanceof Cell) {
		if (isAlist(x)) {
			const obj: Record<string, unknown> = {};
			for (let j: List = x; j !== null; j = j.cdr as List) {
				const pair = j.car as Cell;
				obj[keyName(pair.car)] = lispToJson(pair.cdr);
			}
			return obj;
		}
		return listToArray(x).map(lispToJson);
	}
	return String(x);
}

function jsonToLisp(x: unknown): unknown {
	if (x === null || x === undefined) return null;
	if (x === true) return true;
	if (x === false) return null; // Lisp has only nil for falsity
	if (typeof x === "number" || typeof x === "bigint") return x;
	if (typeof x === "string") return x;
	if (Array.isArray(x)) return arrayToList(x.map(jsonToLisp));
	if (typeof x === "object") {
		const pairs = Object.entries(x as Record<string, unknown>).map(
			([k, v]) => new Cell(k, jsonToLisp(v)),
		);
		return arrayToList(pairs);
	}
	return String(x);
}

// Build the outgoing arguments object from a call-site keyword plist.
function plistToJson(list: List): Record<string, unknown> {
	const plist = parsePlist(list);
	const obj: Record<string, unknown> = {};
	for (const [k, v] of plist) obj[k] = lispToJson(v);
	return obj;
}

// --- Validation --------------------------------------------------------------
function validate(tool: Tool, args: Record<string, unknown>): void {
	const schema = tool.inputSchema;
	if (!schema) return;
	for (const req of schema.required ?? []) {
		if (!(req in args))
			throw new EvalException(
				`${tool.name}: missing required argument "${req}"`,
				null,
				false,
			);
	}
	const props = schema.properties ?? {};
	for (const [key, value] of Object.entries(args)) {
		const spec = props[key];
		if (!spec) continue; // permit extra keys; server decides
		if (spec.type && !typeMatches(spec.type, value))
			throw new EvalException(
				`${tool.name}: argument "${key}" expected ${spec.type}`,
				value,
			);
		if (spec.enum && !spec.enum.includes(value))
			throw new EvalException(
				`${tool.name}: argument "${key}" must be one of ${JSON.stringify(spec.enum)}`,
				value,
			);
	}
}

function typeMatches(type: string, value: unknown): boolean {
	switch (type) {
		case "string":
			return typeof value === "string";
		case "number":
		case "integer":
			return typeof value === "number" || typeof value === "bigint";
		case "boolean":
			return typeof value === "boolean";
		case "array":
			return Array.isArray(value);
		case "object":
			return (
				typeof value === "object" && value !== null && !Array.isArray(value)
			);
		case "null":
			return value === null;
		default:
			return true; // unknown schema type: don't block
	}
}

// --- Server lifecycle --------------------------------------------------------
function connConfigFromArgs(rest: List): ConnConfig {
	const args = listToArray(rest);
	// Bare predefined name: (load-mcp "linear")
	if (args.length === 1 && typeof args[0] === "string") {
		const conf = predefined.get(args[0]);
		if (!conf)
			throw new EvalException("unknown predefined MCP server", args[0], false);
		return conf;
	}
	// Ad-hoc plist: (load-mcp :name "x" :url "..." :headers (...)) etc.
	const opts = parsePlist(rest);
	const name = opts.get("name");
	if (typeof name !== "string")
		throw new EvalException("load-mcp requires a :name string", null, false);
	if (opts.has("url")) {
		const url = opts.get("url");
		if (typeof url !== "string")
			throw new EvalException("load-mcp :url must be a string", url);
		const headers = opts.has("headers")
			? (lispToJson(opts.get("headers")) as Record<string, string>)
			: undefined;
		const oauth = opts.has("oauth") ? opts.get("oauth") !== null : undefined;
		const scopes = opts.has("scopes")
			? listToArray(opts.get("scopes") as List).map(String)
			: undefined;
		return { name, url, headers, oauth, scopes };
	}
	if (opts.has("command")) {
		const command = opts.get("command");
		if (typeof command !== "string")
			throw new EvalException("load-mcp :command must be a string", command);
		const cmdArgs = opts.has("args")
			? listToArray(opts.get("args") as List).map(String)
			: [];
		const env = opts.has("env")
			? (lispToJson(opts.get("env")) as Record<string, string>)
			: undefined;
		return { name, command, args: cmdArgs, env };
	}
	throw new EvalException(
		"load-mcp requires either :url or :command",
		null,
		false,
	);
}

function doUnload(interp: Interp, name: string): Sym[] {
	const rec = servers.get(name);
	if (!rec) throw new EvalException("MCP server not loaded", name, false);
	mcpRequest("disconnect", { serverId: rec.serverId });
	for (const sym of rec.toolSyms) interp.undefineGlobal(sym);
	servers.delete(name);
	return rec.toolSyms;
}

// Install a connected server's tools as global `server/tool` bindings and
// record the server. The finalizer body of a load-mcp job; returns the list of
// installed tool symbols.
function installServer(
	interp: Interp,
	name: string,
	res: { serverId: string; tools: Tool[] },
): List {
	const toolMap = new Map<string, Tool>();
	const toolSyms: Sym[] = [];
	for (const tool of res.tools) {
		toolMap.set(tool.name, tool);
		const sym = newSym(`${name}/${tool.name}`);
		const wrapper = interp.makeBuiltIn(sym.name, -1, (f: unknown[]) => {
			const args = plistToJson(f[0] as List);
			validate(tool, args);
			const result = mcpRequest("call-tool", {
				serverId: res.serverId,
				tool: tool.name,
				args,
			});
			return jsonToLisp(result);
		});
		interp.defineGlobal(sym, wrapper, {
			signature: `(${sym.name} :arg value...)`,
			doc: tool.description ?? "MCP tool (no description provided).",
		});
		toolSyms.push(sym);
	}
	servers.set(name, { name, serverId: res.serverId, toolSyms, tools: toolMap });
	return arrayToList(toolSyms);
}

// --- Built-in installation ---------------------------------------------------
export function registerMcp(interp: Interp): void {
	parsePredefined();

	// (load-mcp "name") | (load-mcp :name "x" :url "..." [:headers al])
	//                   | (load-mcp :name "x" :command "cmd" [:args (...)])
	// Returns a job at once; the connect runs in the background and the server's
	// `server/tool` bindings are installed when the job is collected.
	interp.def(
		"load-mcp",
		-1,
		'(load-mcp "server" [:config "path"])',
		"Start loading an MCP server; returns a job. (await job) connects and installs its `server/tool` bindings, then returns the tool list.",
		z.tuple([zList]),
		([rest]) => {
			const conf = connConfigFromArgs(rest);
			if (servers.has(conf.name)) doUnload(interp, conf.name); // clean reload
			const jobId = mcpStart("connect", conf);
			const job = new Job(jobId, `load-mcp:${conf.name}`, (raw) =>
				installServer(
					interp,
					conf.name,
					raw as { serverId: string; tools: Tool[] },
				),
			);
			liveJobs.add(job);
			return job;
		},
	);

	// (await job [timeout-ms]) -> the job's result (blocks until it settles).
	// For a load-mcp job this installs the tool bindings. Idempotent; on timeout
	// it raises but leaves the job awaitable.
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
			if (job.finalized) return job.cached;
			return collect(job, mcpAwait(job.jobId, parseTimeout(args[1])));
		},
	);

	// (await-all (list job ...) [timeout-ms]) -> list of results, in input order.
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
			const res = mcpRequest(
				"await-all",
				{ jobIds: jobList.map((j) => j.jobId) },
				parseTimeout(args[1]),
			) as { results: SettledReply[] };
			// A failed job collects to (:error "message") in place, so it never
			// discards its succeeded siblings.
			return arrayToList(
				res.results.map((r) => {
					const job = byId.get(r.jobId);
					if (!job)
						throw new EvalException("unknown job in await-all", r.jobId);
					if (!r.ok)
						return arrayToList([newLispKeyword("error"), r.e ?? "unknown"]);
					return collect(job, r.v);
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
			const r = mcpRequest(
				"await-any",
				{ jobIds: jobList.map((j) => j.jobId) },
				parseTimeout(args[1]),
			) as SettledReply;
			const job = byId.get(r.jobId);
			if (!job) throw new EvalException("unknown job in await-any", r.jobId);
			return collectSettled(job, r);
		},
	);

	// (job-status job) -> :pending | :done | :error
	interp.def(
		"job-status",
		1,
		"(job-status job)",
		"Return the status of an async job as a keyword: :pending, :done, or :error.",
		z.tuple([zJob]),
		([job]) => newLispKeyword(job.finalized ? "done" : mcpStatus(job.jobId)),
	);

	// (jobs) -> ((job :status) ...) for every live job.
	interp.def(
		"jobs",
		0,
		"(jobs)",
		"Return the live async jobs, each as (job :status).",
		z.tuple([]),
		() =>
			arrayToList(
				[...liveJobs].map((job) =>
					arrayToList([
						job,
						newLispKeyword(job.finalized ? "done" : mcpStatus(job.jobId)),
					]),
				),
			),
	);

	// (cancel job) -> t ; stop tracking the job (best-effort).
	interp.def(
		"cancel",
		1,
		"(cancel job)",
		"Cancel an async job (best-effort) and stop tracking it.",
		z.tuple([zJob]),
		([job]) => {
			mcpRequest("cancel", { jobId: job.jobId });
			liveJobs.delete(job);
			return true;
		},
	);

	// (unload-mcp "name") -> list of removed symbols
	interp.def(
		"unload-mcp",
		1,
		'(unload-mcp "server")',
		"Unload an MCP server and remove its `server/tool` bindings.",
		z.tuple([zName]),
		([name]) => arrayToList(doUnload(interp, name)),
	);

	// (mcp-authorize "server" "code") -> :authorized. See devdocs/oauth.md.
	interp.def(
		"mcp-authorize",
		-1,
		'(mcp-authorize "server" "code")',
		'Finish OAuth for a server: exchange the authorization `code` from its login link for tokens (saved for reuse). Then (load-mcp "server") connects directly.',
		z.tuple([zList]),
		([rest]) => {
			const args = listToArray(rest);
			const name = typeof args[0] === "string" ? args[0] : asName(args[0]);
			const code = args[1];
			if (typeof code !== "string")
				throw new EvalException(
					"mcp-authorize requires an authorization code string",
					code ?? null,
					false,
				);
			const conf = predefined.get(name);
			if (!conf || !("url" in conf))
				throw new EvalException("unknown OAuth MCP server", name, false);
			mcpRequest("authorize", { url: conf.url, code, scopes: conf.scopes });
			return newLispKeyword("authorized");
		},
	);

	// (login "server") -> auth URL | :logged-in. See devdocs/oauth.md.
	interp.def(
		"login",
		-1,
		'(login "server")',
		'Log in to an OAuth MCP server: begin authorization and return the login URL to open (or :logged-in if already authenticated). After approving, (load-mcp "server") connects.',
		z.tuple([zList]),
		([rest]) => {
			const args = listToArray(rest);
			const name = typeof args[0] === "string" ? args[0] : asName(args[0]);
			const conf = predefined.get(name);
			if (!conf || !("url" in conf))
				throw new EvalException("unknown OAuth MCP server", name, false);
			const res = mcpRequest("login", {
				url: conf.url,
				scopes: conf.scopes,
			}) as { authUrl: string | null };
			return res.authUrl ?? newLispKeyword("logged-in");
		},
	);

	// (logout "server") -> :logged-out. See devdocs/oauth.md.
	interp.def(
		"logout",
		-1,
		'(logout "server")',
		'Log out of an OAuth MCP server: unload it if loaded and delete its saved tokens, so the next (load-mcp "server") re-authorizes.',
		z.tuple([zList]),
		([rest]) => {
			const args = listToArray(rest);
			const name = typeof args[0] === "string" ? args[0] : asName(args[0]);
			const conf = predefined.get(name);
			if (!conf || !("url" in conf))
				throw new EvalException("unknown OAuth MCP server", name, false);
			if (servers.has(name)) doUnload(interp, name);
			mcpRequest("logout", { url: conf.url });
			return newLispKeyword("logged-out");
		},
	);

	// (list-mcps) -> ((name :loaded|:unloaded count) ...)
	interp.def(
		"list-mcps",
		0,
		"(list-mcps)",
		"Return the list of currently loaded MCP servers.",
		z.tuple([]),
		() => {
			const names = new Set<string>([...predefined.keys(), ...servers.keys()]);
			const rows = [...names].map((name) => {
				const rec = servers.get(name);
				return arrayToList([
					name,
					newLispKeyword(rec ? "loaded" : "unloaded"),
					BigInt(rec ? rec.tools.size : 0),
				]);
			});
			return arrayToList(rows);
		},
	);

	// (list-toolkit) -> ((name description :loaded|:unloaded) ...)
	interp.def(
		"list-toolkit",
		0,
		"(list-toolkit)",
		"Return the ready-to-use MCP servers from the toolkit, each as (name description :loaded|:unloaded). Load one by bare name with (load-mcp name).",
		z.tuple([]),
		() => {
			const rows = [...predefined.entries()].map(([name, conf]) =>
				arrayToList([
					name,
					conf.description ?? "",
					newLispKeyword(servers.has(name) ? "loaded" : "unloaded"),
				]),
			);
			return arrayToList(rows);
		},
	);

	// (search-mcps "query") -> ((name score description :loaded|:unloaded) ...)
	interp.def(
		"search-mcps",
		1,
		'(search-mcps "query")',
		"Search the toolkit's MCP servers by name/description; load a match by bare name with (load-mcp name).",
		z.tuple([zName]),
		([rawQuery]) => {
			const query = rawQuery.toLowerCase();
			const terms = query.split(/\s+/).filter(Boolean);
			const scored: {
				name: string;
				score: number;
				description: string;
				loaded: boolean;
			}[] = [];
			for (const [name, conf] of predefined.entries()) {
				const hay = `${name} ${conf.description ?? ""}`.toLowerCase();
				let score = 0;
				for (const t of terms) if (hay.includes(t)) score++;
				if (score > 0)
					scored.push({
						name,
						score,
						description: firstLine(conf.description),
						loaded: servers.has(name),
					});
			}
			scored.sort((a, b) => b.score - a.score);
			return arrayToList(
				scored.map((s) =>
					arrayToList([
						s.name,
						BigInt(s.score),
						s.description,
						newLispKeyword(s.loaded ? "loaded" : "unloaded"),
					]),
				),
			);
		},
	);

	// (list-tools) | (list-tools "server") -> ((sym param-count doc) ...)
	interp.def(
		"list-tools",
		-1,
		'(list-tools ["server"])',
		"Return the tools of all loaded MCP servers (or one server).",
		z.tuple([zList]),
		([rest]) => {
			const only = rest !== null ? asName(rest.car) : null;
			const rows: unknown[] = [];
			for (const rec of servers.values()) {
				if (only !== null && rec.name !== only) continue;
				for (const sym of rec.toolSyms) {
					const tool = rec.tools.get(sym.name.slice(rec.name.length + 1));
					rows.push(
						arrayToList([
							sym,
							BigInt(
								tool?.inputSchema?.properties
									? Object.keys(tool.inputSchema.properties).length
									: 0,
							),
							firstLine(tool?.description),
						]),
					);
				}
			}
			if (only !== null && !servers.has(only))
				throw new EvalException("MCP server not loaded", only, false);
			return arrayToList(rows);
		},
	);

	// (mcp-doc 'server/tool) -> full description + per-parameter docs (string)
	interp.def(
		"mcp-doc",
		1,
		'(mcp-doc "server/tool")',
		"Return the documentation (description and input schema) of an MCP tool.",
		z.tuple([zName]),
		([name]) => {
			const tool = findTool(name);
			if (!tool) throw new EvalException("unknown tool", name, false);
			return renderDoc(name, tool);
		},
	);

	// (search-tools "query") -> ((sym score doc) ...) ranked, best first
	interp.def(
		"search-tools",
		1,
		'(search-tools "query")',
		"Search the tools of all loaded MCP servers by name/description.",
		z.tuple([zName]),
		([rawQuery]) => {
			const query = rawQuery.toLowerCase();
			const terms = query.split(/\s+/).filter(Boolean);
			const scored: { sym: Sym; score: number; doc: string }[] = [];
			for (const rec of servers.values()) {
				for (const sym of rec.toolSyms) {
					const tool = rec.tools.get(sym.name.slice(rec.name.length + 1));
					const hay = `${sym.name} ${tool?.description ?? ""}`.toLowerCase();
					let score = 0;
					for (const t of terms) if (hay.includes(t)) score++;
					if (score > 0)
						scored.push({ sym, score, doc: firstLine(tool?.description) });
				}
			}
			scored.sort((a, b) => b.score - a.score);
			return arrayToList(
				scored.map((s) => arrayToList([s.sym, BigInt(s.score), s.doc])),
			);
		},
	);

	// (mcp-shutdown) -> t ; terminates the broker and clears all state
	interp.def(
		"mcp-shutdown",
		0,
		"(mcp-shutdown)",
		"Shut down the MCP broker worker and unload all servers.",
		z.tuple([]),
		() => {
			servers.clear();
			liveJobs.clear();
			if (worker) {
				void worker.terminate();
				worker = null;
			}
			return true;
		},
	);
}

// --- Helpers -----------------------------------------------------------------
function asName(x: unknown): string {
	if (typeof x === "string") return x;
	if (x instanceof Sym) return x.name;
	if (x instanceof LispKeyword) return x.name;
	throw new EvalException("string or symbol expected", x);
}

function findTool(qualified: string): Tool | undefined {
	const slash = qualified.indexOf("/");
	if (slash < 0) return undefined;
	const server = qualified.slice(0, slash);
	const toolName = qualified.slice(slash + 1);
	return servers.get(server)?.tools.get(toolName);
}

function firstLine(s: string | undefined): string {
	if (!s) return "";
	return s.split("\n")[0];
}

function renderDoc(name: string, tool: Tool): string {
	const lines = [name];
	if (tool.description) lines.push("", tool.description);
	const props = tool.inputSchema?.properties;
	const required = new Set(tool.inputSchema?.required ?? []);
	if (props && Object.keys(props).length) {
		lines.push("", "Arguments:");
		for (const [key, spec] of Object.entries(props)) {
			const req = required.has(key) ? " (required)" : "";
			const type = spec.type ? `:${spec.type}` : "";
			const desc = spec.description ? ` — ${spec.description}` : "";
			lines.push(`  ${key}${type}${req}${desc}`);
		}
	}
	return lines.join("\n");
}

// Expand ${VAR} references against process.env so the toolkit can point at
// environment-provided paths (e.g. the Nix-built browser) without hardcoding
// machine-specific store paths. Unset vars expand to the empty string.
function expandEnv(s: string): string {
	return s.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}

// Register a JSON array of connection configs into the predefined table.
function registerConfigs(raw: string): void {
	try {
		const arr = JSON.parse(raw) as ConnConfig[];
		for (const conf of arr) {
			if (!conf?.name) continue;
			if ("args" in conf && conf.args) conf.args = conf.args.map(expandEnv);
			predefined.set(conf.name, conf);
		}
	} catch {
		// Malformed config: ignore rather than crash the interpreter startup.
	}
}

// Load predefined servers from the bundled mcp.toolkit.json — the single source
// of ready-to-use servers, callable by bare name, e.g. (load-mcp "playwright").
function parsePredefined(): void {
	registerConfigs(
		readFileSync(new URL("../mcp.toolkit.json", import.meta.url), "utf8"),
	);
}
