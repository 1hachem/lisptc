/*
 * MCP integration for Lisptc (main-thread side).
 *
 * Installs the load-mcp / unload-mcp / list-mcps / list-tools / mcp-doc /
 * search-tools / await / await-all / poll / mcp-shutdown built-ins into an
 * Interp. All async MCP work goes through a SyncBridge (default: the
 * worker_threads WorkerBridge, see bridges/worker.ts), which is the only way
 * to call async code from Node's synchronous main thread without
 * deadlocking its event loop. Deployment of the servers themselves (stdio
 * subprocess, HTTP, docker, k8s, ...) is a broker-side adapter concern —
 * see adapter.ts.
 *
 * Loaded tools become ordinary global bindings named "<server>/<tool>",
 * called with native keyword syntax, e.g. (linear/list-issues :query "auth
 * bug"). Passing :async t to a tool call returns an McpFuture immediately
 * instead of blocking; resolve it with (await f), (await-all list) or check
 * it with (poll f).
 */
import { z } from "zod";
import { EvalException } from "../exceptions.ts";
import type { Interp } from "../interp.ts";
import { zList } from "../schemas.ts";
import {
	LispKeyword,
	type List,
	newLispKeyword,
	newSym,
	Sym,
} from "../sexpr.ts";
import type { SyncBridge } from "./bridge.ts";
import { WorkerBridge } from "./bridges/worker.ts";
import { McpFuture } from "./futures.ts";
import {
	arrayToList,
	jsonToLisp,
	lispToJson,
	listToArray,
	parsePlist,
} from "./json.ts";
import type { ConnConfig } from "./protocol.ts";

// A tool/server name argument: a string, symbol or keyword, coerced to string.
const zName = z
	.custom<string | Sym | LispKeyword>(
		(x) =>
			typeof x === "string" || x instanceof Sym || x instanceof LispKeyword,
		"string or symbol expected",
	)
	.transform((x) => asName(x));

const zFuture = z.custom<McpFuture>(
	(x) => x instanceof McpFuture,
	"mcp future expected",
);

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

interface ServerRec {
	name: string;
	serverId: string;
	toolSyms: Sym[];
	tools: Map<string, Tool>;
}

// --- Module state ------------------------------------------------------------
// Shared across interpreters, like the bridge: MCP connections are per
// process, not per Interp.
const servers = new Map<string, ServerRec>();
const predefined = new Map<string, ConnConfig>();

// The default bridge is a lazy process-wide singleton so that every Interp
// (tests create many) shares one broker worker.
let defaultBridge: SyncBridge | null = null;
function getDefaultBridge(): SyncBridge {
	if (!defaultBridge) defaultBridge = new WorkerBridge();
	return defaultBridge;
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
	const deploy = opts.has("deploy") ? asName(opts.get("deploy")) : undefined;
	if (opts.has("url")) {
		const url = opts.get("url");
		if (typeof url !== "string")
			throw new EvalException("load-mcp :url must be a string", url);
		const headers = opts.has("headers")
			? (lispToJson(opts.get("headers")) as Record<string, string>)
			: undefined;
		return { name, deploy, url, headers };
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
		return { name, deploy, command, args: cmdArgs, env };
	}
	throw new EvalException(
		"load-mcp requires either :url or :command",
		null,
		false,
	);
}

function doUnload(interp: Interp, bridge: SyncBridge, name: string): Sym[] {
	const rec = servers.get(name);
	if (!rec) throw new EvalException("MCP server not loaded", name, false);
	bridge.request("disconnect", { serverId: rec.serverId });
	for (const sym of rec.toolSyms) interp.undefineGlobal(sym);
	servers.delete(name);
	return rec.toolSyms;
}

// --- Built-in installation ---------------------------------------------------
export function registerMcp(interp: Interp, bridge?: SyncBridge): void {
	parsePredefined();
	const br = () => bridge ?? getDefaultBridge();

	// (load-mcp "name") | (load-mcp :name "x" :url "..." [:headers al])
	//                   | (load-mcp :name "x" :command "cmd" [:args (...)])
	interp.def(
		"load-mcp",
		-1,
		'(load-mcp "server" [:config "path"])',
		"Load an MCP server from the config file; each of its tools becomes a global function named `server/tool` called with keyword arguments.",
		z.tuple([zList]),
		([rest]) => {
			const conf = connConfigFromArgs(rest);
			if (servers.has(conf.name)) doUnload(interp, br(), conf.name); // clean reload

			const res = br().request("connect", conf) as {
				serverId: string;
				tools: Tool[];
			};
			const toolMap = new Map<string, Tool>();
			const toolSyms: Sym[] = [];
			for (const tool of res.tools) {
				toolMap.set(tool.name, tool);
				const sym = newSym(`${conf.name}/${tool.name}`);
				const wrapper = interp.makeBuiltIn(sym.name, -1, (f: unknown[]) => {
					const plist = parsePlist(f[0] as List);
					// :async t makes the call return an McpFuture immediately.
					const async = plist.get("async") ?? null;
					plist.delete("async");
					const args: Record<string, unknown> = {};
					for (const [k, v] of plist) args[k] = lispToJson(v);
					validate(tool, args);
					const payload = {
						serverId: res.serverId,
						tool: tool.name,
						args,
					};
					if (async !== null)
						return new McpFuture(br().post("call-tool", payload), sym.name);
					return jsonToLisp(br().request("call-tool", payload));
				});
				interp.defineGlobal(sym, wrapper, {
					signature: `(${sym.name} :arg value... [:async t])`,
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
		z.tuple([zName]),
		([name]) => arrayToList(doUnload(interp, br(), name)),
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

	// (await future [timeout-ms]) -> the tool result (blocks until done)
	interp.def(
		"await",
		-2,
		"(await future [timeout-ms])",
		"Block until an :async MCP call completes and return its result. Awaiting the same future again returns the same result.",
		z.tuple([zFuture, zList]),
		([future, rest]) => {
			const timeout = rest !== null ? Number(rest.car) : undefined;
			return jsonToLisp(br().wait(future.ticket, timeout));
		},
	);

	// (await-all (f1 f2 ...)) -> list of results, in the same order
	interp.def(
		"await-all",
		1,
		"(await-all futures)",
		"Block until every future in the list completes; return their results as a list (the calls run concurrently).",
		z.tuple([zList]),
		([futures]) =>
			arrayToList(
				listToArray(futures).map((f) => {
					const parsed = zFuture.safeParse(f);
					if (!parsed.success)
						throw new EvalException("mcp future expected", f);
					return jsonToLisp(br().wait(parsed.data.ticket));
				}),
			),
	);

	// (poll future) -> :pending | :done | :error, without blocking
	interp.def(
		"poll",
		1,
		"(poll future)",
		"Return the status of an :async MCP call without blocking: :pending, :done or :error.",
		z.tuple([zFuture]),
		([future]) => newLispKeyword(br().poll(future.ticket)),
	);

	// (mcp-shutdown) -> t ; terminates the broker and clears all state
	interp.def(
		"mcp-shutdown",
		0,
		"(mcp-shutdown)",
		"Shut down the MCP broker and unload all servers.",
		z.tuple([]),
		() => {
			// Disconnect every server first (best-effort) so deployment
			// adapters get to deprovision the workloads they acquired —
			// terminating the worker outright would leak pods/containers.
			for (const name of [...servers.keys()]) {
				try {
					doUnload(interp, br(), name);
				} catch {
					// A dead server must not block shutdown of the rest.
				}
			}
			servers.clear();
			if (bridge) bridge.shutdown();
			else if (defaultBridge) {
				defaultBridge.shutdown();
				defaultBridge = null;
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
