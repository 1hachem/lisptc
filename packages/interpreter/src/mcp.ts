/*
 * MCP integration for Lisptc (main-thread side).
 *
 * Installs the load-mcp / unload-mcp / list-mcps / list-tools / mcp-doc /
 * search-tools / mcp-shutdown built-ins into an Interp. All async MCP work is
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
import { isNumeric } from "./arith.ts";
import {
	Cell,
	EvalException,
	type Interp,
	LispKeyword,
	type List,
	newLispKeyword,
	newSym,
	Sym,
} from "./lisp.ts";

// --- Broker reply protocol (must match src/mcp-broker.ts) --------------------
const STATE_PENDING = 0;
// STATE_DONE = 1 is implicit: any non-PENDING, non-ERROR, non-SPILL state.
const STATE_ERROR = 2;
const STATE_SPILL = 3;

const CTRL_BYTES = 8; // Int32Array [state, length]
const DATA_BYTES = 1 << 20; // 1 MiB inline reply buffer
const DEFAULT_TIMEOUT_MS = 30_000;

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

type ConnConfig =
	| { name: string; url: string; headers?: Record<string, string> }
	| {
			name: string;
			command: string;
			args?: string[];
			env?: Record<string, string>;
	  };

interface ServerRec {
	name: string;
	serverId: string;
	toolSyms: Sym[];
	tools: Map<string, Tool>;
}

// --- Module state ------------------------------------------------------------
const servers = new Map<string, ServerRec>();
const predefined = new Map<string, ConnConfig>();
let worker: Worker | null = null;

// --- The synchronous bridge --------------------------------------------------
function ensureWorker(): Worker {
	if (worker) return worker;
	worker = new Worker(new URL("./mcp-broker.ts", import.meta.url), {
		execArgv: ["--no-warnings", "--experimental-transform-types"],
	});
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
		return { name, url, headers };
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

// --- Built-in installation ---------------------------------------------------
export function registerMcp(interp: Interp): void {
	parsePredefined();

	// (load-mcp "name") | (load-mcp :name "x" :url "..." [:headers al])
	//                   | (load-mcp :name "x" :command "cmd" [:args (...)])
	interp.def(
		"load-mcp",
		-1,
		'(load-mcp "server" [:config "path"])',
		"Load an MCP server from the config file; each of its tools becomes a global function named `server/tool` called with keyword arguments.",
		(frame: unknown[]) => {
			const rest = frame[0] as List;
			const conf = connConfigFromArgs(rest);
			if (servers.has(conf.name)) doUnload(interp, conf.name); // clean reload

			const res = mcpRequest("connect", conf) as {
				serverId: string;
				tools: Tool[];
			};
			const toolMap = new Map<string, Tool>();
			const toolSyms: Sym[] = [];
			for (const tool of res.tools) {
				toolMap.set(tool.name, tool);
				const sym = newSym(`${conf.name}/${tool.name}`);
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
			servers.set(conf.name, {
				name: conf.name,
				serverId: res.serverId,
				toolSyms,
				tools: toolMap,
			});
			return arrayToList(toolSyms);
		},
	);

	// (unload-mcp "name") -> list of removed symbols
	interp.def(
		"unload-mcp",
		1,
		'(unload-mcp "server")',
		"Unload an MCP server and remove its `server/tool` bindings.",
		(frame: unknown[]) => {
			const name = asName(frame[0]);
			return arrayToList(doUnload(interp, name));
		},
	);

	// (list-mcps) -> ((name :loaded|:unloaded count) ...)
	interp.def(
		"list-mcps",
		0,
		"(list-mcps)",
		"Return the list of currently loaded MCP servers.",
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

	// (list-tools) | (list-tools "server") -> ((sym param-count doc) ...)
	interp.def(
		"list-tools",
		-1,
		'(list-tools ["server"])',
		"Return the tools of all loaded MCP servers (or one server).",
		(frame: unknown[]) => {
			const rest = frame[0] as List;
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
		(frame: unknown[]) => {
			const name = asName(frame[0]);
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
		(frame: unknown[]) => {
			const query = asName(frame[0]).toLowerCase();
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
		() => {
			servers.clear();
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

// Parse the MCP_SERVERS env var (JSON array of connection configs).
function parsePredefined(): void {
	const raw = process.env.MCP_SERVERS;
	if (!raw) return;
	try {
		const arr = JSON.parse(raw) as ConnConfig[];
		for (const conf of arr) if (conf?.name) predefined.set(conf.name, conf);
	} catch {
		// Malformed config: ignore rather than crash the interpreter startup.
	}
}
