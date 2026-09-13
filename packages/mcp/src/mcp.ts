import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isNumeric } from "@repo/interpreter/arith";
import { withTimeout } from "@repo/interpreter/async";
import {
	arrayToList,
	Cell,
	type DocArg,
	EvalException,
	type Interp,
	type InterpExtension,
	jsonToLisp,
	LispKeyword,
	type List,
	listToArray,
	newLispKeyword,
	newSym,
	Sym,
	zList,
} from "@repo/interpreter/lisp";
import { keyName, parsePlist } from "@repo/interpreter/plist";
import type { ToJson } from "@repo/interpreter/types";
import { z } from "zod";
import {
	type ConnConfig,
	type ConnectResult,
	type HttpConnConfig,
	type JsonSchema,
	type McpClient,
	mcpClient,
	stopLocalServers,
	type Tool,
} from "./mcp-client.ts";

const CALL_TIMEOUT_MS = 30_000;

const zName = z
	.custom<string | Sym | LispKeyword>(
		(x) =>
			typeof x === "string" || x instanceof Sym || x instanceof LispKeyword,
		"string or symbol expected",
	)
	.transform((x) => asName(x));

interface ServerRec {
	name: string;
	serverId: string;
	toolSyms: Sym[];
	tools: Map<string, Tool>;
}

export interface RegisterMcpOptions {
	client?: McpClient;
	toolkitJson?: string;
}

function extractAuthCode(raw: string): string {
	const value = raw.trim();
	try {
		return new URL(value).searchParams.get("code") ?? "";
	} catch {
		return value;
	}
}

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
	if (typeof (x as ToJson).toJSON === "function") return (x as ToJson).toJSON();
	return String(x);
}

function plistToJson(list: List): Record<string, unknown> {
	const plist = parsePlist(list);
	const obj: Record<string, unknown> = {};
	for (const [k, v] of plist) obj[k] = lispToJson(v);
	return obj;
}

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
		if (!spec) continue;
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
			return true;
	}
}

function connConfigFromArgs(
	rest: List,
	predefined: Map<string, ConnConfig>,
): ConnConfig {
	const args = listToArray(rest);
	if (args.length === 1) return lookupPredefined(predefined, asName(args[0]));
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
	client: McpClient,
	servers: Map<string, ServerRec>,
	name: string,
): Sym[] {
	const rec = servers.get(name);
	if (!rec) throw new EvalException("MCP server not loaded", name, false);
	void client.disconnect(rec.serverId).catch(() => {});
	for (const sym of rec.toolSyms) interp.undefineGlobal(sym);
	servers.delete(name);
	return rec.toolSyms;
}

function installServer(
	interp: Interp,
	client: McpClient,
	servers: Map<string, ServerRec>,
	name: string,
	res: ConnectResult,
): List {
	const toolMap = new Map<string, Tool>();
	const toolSyms: Sym[] = [];
	for (const tool of res.tools) {
		toolMap.set(tool.name, tool);
		const sym = newSym(`${name}/${tool.name}`);
		const wrapper = interp.makeBuiltIn(sym.name, -1, (f: unknown[]) => {
			const args = plistToJson(f[0] as List);
			validate(tool, args);
			return withTimeout(
				client.callTool({ serverId: res.serverId, tool: tool.name, args }),
				CALL_TIMEOUT_MS,
				sym.name,
			).then(jsonToLisp);
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

const PROMPT: string = readFileSync(
	new URL("./mcp.ptc", import.meta.url),
	"utf8",
);

export function mcpExtension(
	options: RegisterMcpOptions = {},
): InterpExtension {
	return Object.assign((interp: Interp): void => registerMcp(interp, options), {
		prompt: PROMPT,
	});
}

const FROM_SOURCE = import.meta.url.endsWith(".ts");

const TOOLKIT_URL = new URL(
	FROM_SOURCE ? "../mcp.toolkit.json" : "./mcp.toolkit.json",
	import.meta.url,
);

export function registerMcp(
	interp: Interp,
	options: RegisterMcpOptions = {},
): void {
	const client = options.client ?? mcpClient;

	const servers = new Map<string, ServerRec>();
	const predefined = new Map<string, ConnConfig>();
	const loading = new Set<Promise<unknown>>();
	parsePredefined(predefined, options.toolkitJson);

	function startLoad(conf: ConnConfig): Promise<unknown> {
		const promise = interp.async.start((signal) =>
			client
				.connect(conf, signal)
				.then((res) => installServer(interp, client, servers, conf.name, res)),
		);
		loading.add(promise);
		const forget = () => loading.delete(promise);
		void promise.then(forget, forget);
		return promise;
	}

	interp.defPromise(
		"load-mcp",
		-1,
		'(load-mcp "server") | (load-mcp :name "server")',
		'Start loading an MCP server; returns a job. (await job) connects and installs its `server/tool` bindings, then returns the tool list. A toolkit server is loaded by the name (search-mcps)/(list-toolkit) reported — (load-mcp "name") or (load-mcp :name "name"); pass :url or :command to load an ad-hoc server instead.',
		z.tuple([zList]),
		([rest]) => {
			const conf = connConfigFromArgs(rest, predefined);
			if (servers.has(conf.name)) doUnload(interp, client, servers, conf.name);
			return startLoad(conf);
		},
		LOAD_MCP_ARGS,
	);

	interp.def(
		"unload-mcp",
		1,
		'(unload-mcp "server")',
		"Unload an MCP server and remove its `server/tool` bindings.",
		z.tuple([zName]),
		([name]) => arrayToList(doUnload(interp, client, servers, name)),
	);

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
			const code = extractAuthCode(raw);
			if (!code)
				throw new EvalException(
					"no authorization code found in the pasted value",
					raw,
					false,
				);
			const conf = oauthServer(predefined, name);
			return withTimeout(
				client.authorize(conf, code),
				CALL_TIMEOUT_MS,
				"mcp-authorize",
			).then(() => newLispKeyword("authorized"));
		},
	);

	interp.def(
		"login",
		-1,
		'(login "server")',
		'Log in to an OAuth MCP server: begin authorization and return the login URL to open (or :logged-in if already authenticated). After approving, (load-mcp "server") connects.',
		z.tuple([zList]),
		([rest]) => {
			const args = listToArray(rest);
			const name = typeof args[0] === "string" ? args[0] : asName(args[0]);
			const conf = oauthServer(predefined, name);
			return withTimeout(client.login(conf), CALL_TIMEOUT_MS, "login").then(
				(res) => res.authUrl ?? newLispKeyword("logged-in"),
			);
		},
	);

	interp.def(
		"logout",
		-1,
		'(logout "server")',
		'Log out of an OAuth MCP server: unload it if loaded and delete its saved tokens, so the next (load-mcp "server") re-authorizes.',
		z.tuple([zList]),
		([rest]) => {
			const args = listToArray(rest);
			const name = typeof args[0] === "string" ? args[0] : asName(args[0]);
			const conf = oauthServer(predefined, name);
			if (servers.has(name)) doUnload(interp, client, servers, name);
			return withTimeout(client.logout(conf), CALL_TIMEOUT_MS, "logout").then(
				() => newLispKeyword("logged-out"),
			);
		},
	);

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

	interp.def(
		"list-toolkit",
		0,
		"(list-toolkit)",
		'Return the ready-to-use MCP servers from the toolkit, each as (name description keywords :loaded|:unloaded). Load one by bare name with (load-mcp name); search the same keywords with (search-mcps "query").',
		z.tuple([]),
		() => {
			const rows = [...predefined.entries()].map(([name, conf]) =>
				arrayToList([
					name,
					conf.description ?? "",
					arrayToList(conf.keywords ?? []),
					newLispKeyword(servers.has(name) ? "loaded" : "unloaded"),
				]),
			);
			return arrayToList(rows);
		},
	);

	interp.def(
		"search-mcps",
		1,
		'(search-mcps "query")',
		"Search the toolkit's MCP servers by name, keywords and description, best match first; each row is (name score description :loaded|:unloaded). Load a match by bare name with (load-mcp name); (list-toolkit) shows every server's keywords.",
		z.tuple([zName]),
		([rawQuery]) => {
			const terms = rawQuery.toLowerCase().split(/\s+/).filter(Boolean);
			const scored: { conf: ConnConfig; score: number }[] = [];
			for (const conf of predefined.values()) {
				const score = scoreToolkitEntry(terms, conf);
				if (score > 0) scored.push({ conf, score });
			}
			scored.sort(
				(a, b) => b.score - a.score || a.conf.name.localeCompare(b.conf.name),
			);
			return arrayToList(
				scored.map(({ conf, score }) =>
					arrayToList([
						conf.name,
						BigInt(score),
						firstLine(conf.description),
						newLispKeyword(servers.has(conf.name) ? "loaded" : "unloaded"),
					]),
				),
			);
		},
	);

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

	const shutdown = (): void => {
		for (const rec of servers.values()) {
			void client.disconnect(rec.serverId).catch(() => {});
			for (const sym of rec.toolSyms) interp.undefineGlobal(sym);
		}
		servers.clear();
		for (const promise of loading) interp.async.cancel(promise);
		loading.clear();
		stopLocalServers();
	};

	interp.def(
		"mcp-shutdown",
		0,
		"(mcp-shutdown)",
		"Disconnect every loaded MCP server and unload its bindings.",
		z.tuple([]),
		() => {
			shutdown();
			return true;
		},
	);

	interp.hooks.dispose.use((next) => {
		shutdown();
		next();
	});
}

function oauthServer(
	predefined: Map<string, ConnConfig>,
	name: string,
): HttpConnConfig {
	const conf = predefined.get(name);
	if (!conf || !("url" in conf))
		throw new EvalException("unknown OAuth MCP server", name, false);
	return conf;
}

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

const SUBSTRING_MIN = 3;

function scoreToolkitEntry(terms: string[], conf: ConnConfig): number {
	const name = conf.name.toLowerCase();
	const keywords = (conf.keywords ?? []).map((k) => k.toLowerCase());
	const description = (conf.description ?? "").toLowerCase();
	let score = 0;
	for (const term of terms) {
		if (name === term || keywords.includes(term)) score += 3;
		else if (term.length < SUBSTRING_MIN) continue;
		else if (name.includes(term) || keywords.some((k) => k.includes(term)))
			score += 2;
		else if (description.includes(term)) score += 1;
	}
	return score;
}

function schemaType(spec: JsonSchema): string {
	if (!spec.type) return "";
	if (spec.type === "array") {
		const item = spec.items ? schemaType(spec.items) : "";
		return item ? `:list<${item}>` : ":list";
	}
	return `:${spec.type}`;
}

function orderedProps(tool: Tool): [string, JsonSchema][] {
	const props = tool.inputSchema?.properties;
	if (!props) return [];
	const required = new Set(tool.inputSchema?.required ?? []);
	return Object.entries(props).sort(
		(a, b) => (required.has(a[0]) ? 0 : 1) - (required.has(b[0]) ? 0 : 1),
	);
}

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

function toolArgs(tool: Tool): DocArg[] {
	const required = new Set(tool.inputSchema?.required ?? []);
	return orderedProps(tool).map(([key, spec]) => ({
		name: key,
		type: schemaType(spec),
		required: required.has(key),
		description: spec.description,
	}));
}

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

function expandEnv(s: string): string {
	// biome-ignore lint/style/noProcessEnv: mcp.toolkit.json names the variable, so it is only known at runtime
	return s.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}

function resolveBundled(s: string): string {
	return s.startsWith("./") || s.startsWith("../")
		? fileURLToPath(new URL(s, TOOLKIT_URL))
		: s;
}

function registerConfigs(
	raw: string,
	predefined: Map<string, ConnConfig>,
): void {
	try {
		const arr = JSON.parse(raw) as ConnConfig[];
		for (const conf of arr) {
			if (!conf?.name) continue;
			if ("args" in conf && conf.args)
				conf.args = conf.args.map((a) => resolveBundled(expandEnv(a)));
			predefined.set(conf.name, conf);
		}
	} catch {}
}

function parsePredefined(
	predefined: Map<string, ConnConfig>,
	toolkitJson?: string,
): void {
	registerConfigs(toolkitJson ?? readFileSync(TOOLKIT_URL, "utf8"), predefined);
}
