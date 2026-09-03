/*
 * MCP integration for Lisptc (main-thread side).
 *
 * Installs the load-mcp / unload-mcp / list-mcps / list-toolkit / list-tools /
 * search-tools / search-mcps / mcp-shutdown built-ins into an Interp (tool docs
 * surface through the generic `doc` built-in — see defineGlobal below).
 *
 * The async capability is factored out into the generic jobs runtime
 * (src/jobs.ts): this module owns only the MCP domain. It builds a `Jobs` over a
 * `JobsRuntime` (default: a worker thread running the MCP broker, src/mcp-broker.ts),
 * installs the generic job built-ins (await/jobs/cancel/…) via that Jobs, and
 * adds the MCP built-ins on top — load-mcp starts a background job, tool calls
 * and lifecycle ops are blocking `runtime.call`s.
 *
 * Loaded tools become ordinary global bindings named "<server>/<tool>", called
 * with native keyword syntax, e.g. (linear/list-issues :query "auth bug").
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { isNumeric } from "./arith.ts";
import { Job, Jobs, type JobsRuntime, WorkerJobsRuntime } from "./jobs.ts";
import {
	Cell,
	type DocArg,
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
import { keyName, parsePlist } from "./plist.ts";

// A tool/server name argument: a string, symbol or keyword, coerced to string.
const zName = z
	.custom<string | Sym | LispKeyword>(
		(x) =>
			typeof x === "string" || x instanceof Sym || x instanceof LispKeyword,
		"string or symbol expected",
	)
	.transform((x) => asName(x));

// --- Types -------------------------------------------------------------------
export interface Tool {
	name: string;
	description?: string;
	inputSchema?: JsonSchema;
	outputSchema?: JsonSchema;
}

export interface JsonSchema {
	type?: string;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	enum?: unknown[];
	description?: string;
	items?: JsonSchema;
	default?: unknown;
	examples?: unknown[];
}

export type ConnConfig = { description?: string } & (
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

// MCP builds on the generic async-jobs runtime (src/jobs.ts): load-mcp starts a
// background job, tool calls / lifecycle ops are blocking `runtime.call`s. The
// runtime is swappable — the default offloads to a worker thread running the MCP
// broker; a different backend (e.g. a Redis queue) can implement JobsRuntime.
export interface RegisterMcpOptions {
	runtime?: JobsRuntime;
	toolkitJson?: string;
}

// Pull the authorization `code` out of a pasted callback link, or accept a bare
// code as-is. Users tend to copy the whole redirect URL (…/callback?code=…&state=…)
// rather than just the code, which otherwise fails the token exchange.
function extractAuthCode(raw: string): string {
	const value = raw.trim();
	try {
		// A URL yields its `code` param (empty string if the redirect carried an
		// error instead), never the raw URL as a bogus code.
		return new URL(value).searchParams.get("code") ?? "";
	} catch {
		// not a URL: treat it as a bare code
		return value;
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
function connConfigFromArgs(
	rest: List,
	predefined: Map<string, ConnConfig>,
): ConnConfig {
	const args = listToArray(rest);
	// Bare predefined name: (load-mcp "linear")
	if (args.length === 1) return lookupPredefined(predefined, asName(args[0]));
	// Ad-hoc plist: (load-mcp :name "x" :url "..." :headers (...)) etc.
	const opts = parsePlist(rest);
	const rawName = opts.get("name");
	if (rawName === undefined || rawName === null)
		throw new EvalException(
			"load-mcp requires a :name",
			rawName ?? null,
			false,
		);
	const name = asName(rawName);
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
	// Neither :url nor :command: `:name` names a toolkit server, so
	// (load-mcp :name "playwright") means the same as (load-mcp "playwright").
	return lookupPredefined(predefined, name);
}

function lookupPredefined(
	predefined: Map<string, ConnConfig>,
	name: string,
): ConnConfig {
	const conf = predefined.get(name);
	if (!conf)
		throw new EvalException("unknown predefined MCP server", name, false);
	return conf;
}

// Structured args for load-mcp's ad-hoc-plist calling convention, mirroring
// what connConfigFromArgs above actually accepts — for the LSP's keyword-arg
// completion/diagnostics (see toolArgs below for the equivalent on MCP
// tools). `required` only marks `:name`: the url/command choice is a branch
// (either `:url` + optional :headers/:oauth/:scopes, or `:command` +
// optional :args/:env), and a flat DocArg list can't express "one of", so
// marking both `:url` and `:command` required would make every valid call
// look like it's missing the other one.
const LOAD_MCP_ARGS: DocArg[] = [
	{
		name: "name",
		type: "string",
		required: true,
		description: "A name for this server; its tools install as `name/tool`.",
	},
	{
		name: "command",
		type: "string",
		required: false,
		description: "Spawn a stdio server by running this command.",
	},
	{
		name: "args",
		type: "list",
		required: false,
		description: "Arguments to `:command`.",
	},
	{
		name: "env",
		type: "alist",
		required: false,
		description: "Extra environment variables for `:command`.",
	},
	{
		name: "url",
		type: "string",
		required: false,
		description:
			"Connect to an HTTP server at this URL instead of spawning one.",
	},
	{
		name: "headers",
		type: "alist",
		required: false,
		description: "Extra HTTP headers for the `:url` connection.",
	},
	{
		name: "oauth",
		type: "boolean",
		required: false,
		description:
			"Treat the `:url` server as OAuth 2.1; load-mcp then returns an authorization link.",
	},
	{
		name: "scopes",
		type: "list",
		required: false,
		description: "OAuth scopes to request when `:oauth` is set.",
	},
];

function doUnload(
	interp: Interp,
	runtime: JobsRuntime,
	servers: Map<string, ServerRec>,
	name: string,
): Sym[] {
	const rec = servers.get(name);
	if (!rec) throw new EvalException("MCP server not loaded", name, false);
	runtime.call("disconnect", { serverId: rec.serverId });
	for (const sym of rec.toolSyms) interp.undefineGlobal(sym);
	servers.delete(name);
	return rec.toolSyms;
}

// Install a connected server's tools as global `server/tool` bindings and
// record the server. The finalizer body of a load-mcp job; returns the list of
// installed tool symbols.
function installServer(
	interp: Interp,
	runtime: JobsRuntime,
	servers: Map<string, ServerRec>,
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
			const result = runtime.call("call-tool", {
				serverId: res.serverId,
				tool: tool.name,
				args,
			});
			return jsonToLisp(result);
		});
		interp.defineGlobal(sym, wrapper, {
			signature: toolSignature(sym.name, tool),
			doc: toolDocBody(tool) || "MCP tool (no description provided).",
			args: toolArgs(tool),
		});
		toolSyms.push(sym);
	}
	servers.set(name, { name, serverId: res.serverId, toolSyms, tools: toolMap });
	return arrayToList(toolSyms);
}

// --- Built-in installation ---------------------------------------------------
export function mcpExtension(options: RegisterMcpOptions = {}) {
	return (interp: Interp): void => registerMcp(interp, options);
}

// This module is loaded either as its own source (node runs the .ts directly)
// or as part of a build, where it is JavaScript and its neighbours were emitted
// beside it. A worker is a second entry point by definition, so it can never be
// folded into a bundle — it is always a sibling file, under whichever extension
// this module itself has.
const FROM_SOURCE = import.meta.url.endsWith(".ts");
const BROKER_URL = new URL(
	FROM_SOURCE ? "./mcp-broker.ts" : "./mcp-broker.js",
	import.meta.url,
);

// Same story for the toolkit: it sits at the package root next to `src/`, and a
// build emits it beside the code instead.
const TOOLKIT_URL = new URL(
	FROM_SOURCE ? "../mcp.toolkit.json" : "./mcp.toolkit.json",
	import.meta.url,
);

export function registerMcp(
	interp: Interp,
	options: RegisterMcpOptions = {},
): void {
	const runtime = options.runtime ?? new WorkerJobsRuntime(BROKER_URL);
	// The async capability (await/jobs/cancel/…) is generic; MCP just plugs in.
	const jobs = new Jobs(runtime, jsonToLisp);
	jobs.installBuiltins(interp);

	const servers = new Map<string, ServerRec>();
	const predefined = new Map<string, ConnConfig>();
	parsePredefined(predefined, options.toolkitJson);

	// (load-mcp "name") | (load-mcp :name "name")
	//                   | (load-mcp :name "x" :url "..." [:headers al])
	//                   | (load-mcp :name "x" :command "cmd" [:args (...)])
	// Returns a job at once; the connect runs in the background and the server's
	// `server/tool` bindings are installed when the job is collected.
	interp.def(
		"load-mcp",
		-1,
		'(load-mcp "server") | (load-mcp :name "server")',
		'Start loading an MCP server; returns a job. (await job) connects and installs its `server/tool` bindings, then returns the tool list. A toolkit server is loaded by the name (search-mcps)/(list-toolkit) reported — (load-mcp "name") or (load-mcp :name "name"); pass :url or :command to load an ad-hoc server instead.',
		z.tuple([zList]),
		([rest]) => {
			const conf = connConfigFromArgs(rest, predefined);
			if (servers.has(conf.name)) doUnload(interp, runtime, servers, conf.name);
			const jobId = runtime.start("connect", conf);
			const job = new Job(jobId, `load-mcp:${conf.name}`, (raw) =>
				installServer(
					interp,
					runtime,
					servers,
					conf.name,
					raw as { serverId: string; tools: Tool[] },
				),
			);
			jobs.track(job);
			return job;
		},
		LOAD_MCP_ARGS,
	);

	// (unload-mcp "name") -> list of removed symbols
	interp.def(
		"unload-mcp",
		1,
		'(unload-mcp "server")',
		"Unload an MCP server and remove its `server/tool` bindings.",
		z.tuple([zName]),
		([name]) => arrayToList(doUnload(interp, runtime, servers, name)),
	);

	// (mcp-authorize "server" "code") -> :authorized. See devdocs/oauth.md.
	interp.def(
		"mcp-authorize",
		-1,
		'(mcp-authorize "server" "code")',
		'Finish OAuth for a server: exchange the authorization `code` for tokens (saved for reuse). Accepts either the bare code or the whole pasted callback link. Then (load-mcp "server") connects directly.',
		z.tuple([zList]),
		([rest]) => {
			const args = listToArray(rest);
			const name = typeof args[0] === "string" ? args[0] : asName(args[0]);
			const raw = args[1];
			if (typeof raw !== "string")
				throw new EvalException(
					"mcp-authorize requires an authorization code string",
					raw ?? null,
					false,
				);
			// Accept either a bare code or the whole pasted callback link
			// (e.g. http://127.0.0.1:.../callback?code=…&state=…).
			const code = extractAuthCode(raw);
			if (!code)
				throw new EvalException(
					"no authorization code found in the pasted value",
					raw,
					false,
				);
			const conf = predefined.get(name);
			if (!conf || !("url" in conf))
				throw new EvalException("unknown OAuth MCP server", name, false);
			runtime.call("authorize", { url: conf.url, code, scopes: conf.scopes });
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
			const res = runtime.call("login", {
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
			if (servers.has(name)) doUnload(interp, runtime, servers, name);
			runtime.call("logout", { url: conf.url });
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
			// Undefine every installed <server>/<tool> global so stale bindings
			// don't linger with a closure capturing a now-dead serverId.
			for (const rec of servers.values())
				for (const sym of rec.toolSyms) interp.undefineGlobal(sym);
			servers.clear();
			jobs.shutdown();
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

function firstLine(s: string | undefined): string {
	if (!s) return "";
	return s.split("\n")[0];
}

// Render a JSON-schema type as a short Lisp-facing type tag, e.g. `:string`,
// `:list<:number>`, `:object`. Used in both the usage signature and per-arg docs.
function schemaType(spec: JsonSchema): string {
	if (!spec.type) return "";
	if (spec.type === "array") {
		const item = spec.items ? schemaType(spec.items) : "";
		return item ? `:list<${item}>` : ":list";
	}
	return `:${spec.type}`;
}

// Property entries sorted so required args come first — the call order the
// usage signature and argument list both read left-to-right.
function orderedProps(tool: Tool): [string, JsonSchema][] {
	const props = tool.inputSchema?.properties;
	if (!props) return [];
	const required = new Set(tool.inputSchema?.required ?? []);
	return Object.entries(props).sort(
		(a, b) => (required.has(a[0]) ? 0 : 1) - (required.has(b[0]) ? 0 : 1),
	);
}

// The keyword-call usage signature, e.g. `(fx/echo :message :string [:n :number])`.
// Optional args are wrapped in `[...]`. Reused for the `signature` metadata on
// each tool binding so the LSP hover and the generic `doc` built-in show the
// same call shape.
function toolSignature(name: string, tool: Tool): string {
	const entries = orderedProps(tool);
	if (!entries.length) return `(${name})`;
	const required = new Set(tool.inputSchema?.required ?? []);
	const sig = entries
		.map(([key, spec]) => {
			const pair = `:${key} ${schemaType(spec) || "<value>"}`;
			return required.has(key) ? pair : `[${pair}]`;
		})
		.join(" ");
	return `(${name} ${sig})`;
}

// Structured per-argument info for a tool's Doc.args, e.g. for the LSP's
// keyword-argument completion. Same order/content as the usage signature and
// the "Arguments:" doc section, just not rendered to text.
function toolArgs(tool: Tool): DocArg[] {
	const required = new Set(tool.inputSchema?.required ?? []);
	return orderedProps(tool).map(([key, spec]) => ({
		name: key,
		type: schemaType(spec),
		required: required.has(key),
		description: spec.description,
	}));
}

// The prose body: description, per-argument docs, and example inputs/outputs
// when the schema advertises them. Stored as the binding's `doc` metadata via
// defineGlobal, so it's what both the generic `doc` built-in and the LSP
// hover render.
function toolDocBody(tool: Tool): string {
	const lines: string[] = [];
	if (tool.description) lines.push(tool.description);
	const entries = orderedProps(tool);
	const required = new Set(tool.inputSchema?.required ?? []);

	if (entries.length) {
		if (lines.length) lines.push("");
		lines.push("Arguments:");
		for (const [key, spec] of entries) {
			const req = required.has(key) ? " (required)" : "";
			const type = schemaType(spec);
			const desc = spec.description ? ` — ${spec.description}` : "";
			const allowed = spec.enum?.length
				? ` (one of ${JSON.stringify(spec.enum)})`
				: "";
			const dflt =
				spec.default !== undefined
					? ` (default ${JSON.stringify(spec.default)})`
					: "";
			const example = spec.examples?.length
				? ` (e.g. ${JSON.stringify(spec.examples[0])})`
				: "";
			lines.push(`  ${key}${type}${req}${allowed}${dflt}${example}${desc}`);
		}
	}

	const inputEx = tool.inputSchema?.examples;
	if (inputEx?.length) {
		lines.push("", "Example inputs:");
		for (const ex of inputEx) lines.push(`  ${JSON.stringify(ex)}`);
	}
	if (tool.outputSchema) {
		const out = tool.outputSchema;
		const outType = schemaType(out);
		if (outType || out.description) {
			lines.push(
				"",
				`Returns: ${outType}${out.description ? ` — ${out.description}` : ""}`.trim(),
			);
		}
		if (out.examples?.length) {
			lines.push("", "Example outputs:");
			for (const ex of out.examples) lines.push(`  ${JSON.stringify(ex)}`);
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
function registerConfigs(
	raw: string,
	predefined: Map<string, ConnConfig>,
): void {
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
function parsePredefined(
	predefined: Map<string, ConnConfig>,
	toolkitJson?: string,
): void {
	registerConfigs(toolkitJson ?? readFileSync(TOOLKIT_URL, "utf8"), predefined);
}
