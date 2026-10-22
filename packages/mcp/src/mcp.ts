import { isNumeric } from "@repo/interpreter/arith";
import { type Ask, asking } from "@repo/interpreter/asks";
import type { Progress } from "@repo/interpreter/async";
import { topic } from "@repo/interpreter/channels";
import type { DocArg, DocArgSpec, DocValue } from "@repo/interpreter/docs";
import { settled } from "@repo/interpreter/drive";
import {
	EvalException,
	StepHold,
	UnresolvedHead,
} from "@repo/interpreter/errors";
import type { Interp, State, StateCodec } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	jsonToLisp,
	LispKeyword,
	type List,
	listToArray,
	newLispKeyword,
	newSym,
	Sym,
} from "@repo/interpreter/objects";
import { keyName, parsePlist } from "@repo/interpreter/plist";
import type { LispPromise } from "@repo/interpreter/promise";
import { zList } from "@repo/interpreter/schema";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { withTimeout } from "@repo/interpreter/timeout";
import type { ToJson } from "@repo/interpreter/types";
import type { PromptSource } from "@repo/shared/host";
import type { SearchDocument, SearchEngine } from "@repo/shared/search";
import { z } from "zod";
import {
	AuthorizationRequired,
	type ConnConfig,
	type ConnectResult,
	type HttpConnConfig,
	type JsonSchema,
	type McpClient,
	type McpMount,
	type McpPolicy,
	type McpRegistry,
	memoryRegistry,
	type OAuthConnConfig,
	openPolicy,
	type Tool,
	type ToolkitRegistry,
} from "./ports.ts";

const CALL_TIMEOUT_MS = 30_000;

const AUTHORIZE_ACTION = "mcp/authorize";

const authorizationAsked = topic<Ask>("mcp-authorization");

const authorizationAnswered = topic<{
	id: string;
	server: string;
	approved: boolean;
}>("mcp-authorization-answered");

function authorizationAsk(server: string, url: string): Ask {
	const id = new URL(url).searchParams.get("state") ?? url;
	const answer = (approved: boolean) => ({
		action: AUTHORIZE_ACTION,
		values: { id, server, approved },
	});
	return {
		id,
		title: server,
		prompt: `${server} needs you to sign in before the agent can use it.`,
		choices: [
			{
				label: "Not now",
				done: "Not authorized",
				accepts: false,
				answer: answer(false),
			},
			{
				label: "Authorize",
				done: "Authorized",
				accepts: true,
				answer: answer(true),
				opens: url,
				primary: true,
			},
		],
	};
}

function holdForAuthorization(interp: Interp, error: unknown): unknown {
	if (!(error instanceof AuthorizationRequired)) return error;
	authorizationAsked.emit(interp.channels, {
		user: authorizationAsk(error.server, error.url),
	});
	return new StepHold(
		`${error.message}. The turn ends here; you will be told when they answer`,
	);
}

function answerAuthorization(hooks: SessionHooks): void {
	hooks.invoke.use(async (ctx, next) => {
		if (ctx.action !== AUTHORIZE_ACTION) return next(ctx);
		const { id, server, approved } = ctx.values;
		if (typeof id !== "string" || typeof server !== "string")
			throw new EvalException(
				"an authorization answer names no server",
				id ?? null,
				false,
			);
		authorizationAnswered.emit(ctx.interp.channels, {
			user: { id, server, approved: approved === true || approved === "true" },
		});
	});
	hooks.annotate.use((buffer, into, next) =>
		next(
			buffer,
			asking(into, {
				open: buffer.collect(authorizationAsked),
				answered: Object.fromEntries(
					buffer.collect(authorizationAnswered).map((a) => [
						a.id,
						{
							accepted: a.approved,
							label: a.approved ? "Authorized" : "Not authorized",
						},
					]),
				),
			}),
		),
	);
	hooks.message.use((buffer, next) => {
		const answers = buffer.collect(authorizationAnswered);
		if (answers.length === 0) return next(buffer);
		return answers
			.map(({ server, approved }) =>
				approved
					? `The user authorized "${server}". Run (load-mcp "${server}") again and carry on with what you were doing.`
					: `The user declined to authorize "${server}". Do not load it again unless they ask.`,
			)
			.join("\n\n");
	});
}

const zName = z
	.custom<string | Sym | LispKeyword>(
		(x) =>
			typeof x === "string" || x instanceof Sym || x instanceof LispKeyword,
		"string or symbol expected",
	)
	.transform((x) => asName(x));

interface ServerEntry {
	readonly name: string;
	readonly serverId: string;
	readonly state: "loaded" | "dormant" | "failed";
	readonly reason?: string;
	readonly tools: readonly Tool[];
	readonly args: List;
}

type Servers = State<ServerEntry[]>;

const TOOL_TAG = "mcp/tool";

interface ToolRef {
	readonly server: string;
	readonly tool: string;
}

function field(alist: unknown, key: string): unknown {
	for (let j = alist as List; j !== null; j = j.cdr as List) {
		const pair = j.car;
		if (pair instanceof Cell && pair.car === key) return pair.cdr;
	}
	return null;
}

const serverCodec: StateCodec<ServerEntry[]> = {
	toLisp: (entries) =>
		arrayToList(
			entries.map(
				(entry) =>
					new Cell(
						new Cell("args", entry.args),
						jsonToLisp({
							name: entry.name,
							"server-id": entry.serverId,
							state: entry.state,
							reason: entry.reason ?? null,
							tools: JSON.stringify(entry.tools),
						}),
					),
			),
		),
	fromLisp: (list) =>
		listToArray(list as List).map((alist) => {
			const reason = field(alist, "reason");
			return {
				name: field(alist, "name") as string,
				serverId: field(alist, "server-id") as string,
				state: field(alist, "state") as ServerEntry["state"],
				reason: typeof reason === "string" ? reason : undefined,
				tools: JSON.parse(field(alist, "tools") as string) as Tool[],
				args: field(alist, "args") as List,
			};
		}),
};

function entryOf(servers: Servers, name: string): ServerEntry | undefined {
	return servers.get().find((entry) => entry.name === name);
}

function statusOf(servers: Servers, name: string): LispKeyword {
	return newLispKeyword(entryOf(servers, name)?.state ?? "unloaded");
}

function toolSyms(entry: ServerEntry): Sym[] {
	return entry.tools.map((tool) => newSym(`${entry.name}/${tool.name}`));
}

export interface McpExtensionHost {
	client: McpClient;
	toolkit: ToolkitRegistry;
	search: SearchEngine;
	prompt: PromptSource;
	policy?: McpPolicy;
	registry?: McpRegistry;
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
	if (opts.has("command"))
		throw new EvalException(
			"load-mcp :command is not supported: load a toolkit server by name, (search-mcps) finds one",
			name,
			false,
		);
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

const LOAD_MCP_NAME: DocArg = {
	name: "name",
	type: "string",
	required: true,
	description: "A name for this server; its tools install as `name/tool`.",
};

const LOAD_MCP_OPTIONS: DocArg[] = [
	{
		name: "url",
		type: "string",
		required: false,
		description: "Connect to an HTTP server at this URL.",
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
			"Treat the `:url` server as OAuth 2.1; load-mcp then asks the user to authorize it.",
	},
	{
		name: "scopes",
		type: "list",
		required: false,
		description: "OAuth scopes to request when `:oauth` is set.",
	},
];

function loadMcpArgs(predefined: Map<string, ConnConfig>): DocArg[] {
	const values = [...predefined.values()].map((conf) => ({
		value: conf.name,
		description: conf.description,
	}));
	return [{ ...LOAD_MCP_NAME, values }, ...LOAD_MCP_OPTIONS];
}

function doUnload(
	interp: Interp,
	client: McpClient,
	servers: Servers,
	name: string,
): Sym[] {
	const entry = entryOf(servers, name);
	if (!entry) throw new EvalException("MCP server not loaded", name, false);
	if (entry.state === "loaded")
		void client.disconnect(entry.serverId).catch(() => {});
	const syms = toolSyms(entry);
	for (const sym of syms) interp.undefineGlobal(sym);
	servers.set(servers.get().filter((e) => e.name !== name));
	return syms;
}

function serverOf(error: EvalException): string | undefined {
	if (!(error instanceof UnresolvedHead) || error.why !== "undefined")
		return undefined;
	const name = error.callee;
	if (name === undefined) return undefined;
	const at = name.lastIndexOf("/");
	return at < 0 ? undefined : name.slice(0, at);
}

function notLoaded(
	error: EvalException,
	predefined: Map<string, ConnConfig>,
	servers: Servers,
): string | undefined {
	const server = serverOf(error);
	if (
		server === undefined ||
		entryOf(servers, server) !== undefined ||
		!predefined.has(server)
	)
		return undefined;
	return `${String(error)}\n${server} is in the toolkit and not loaded: (load-mcp "${server}")`;
}

interface Wiring {
	readonly interp: Interp;
	readonly client: McpClient;
	readonly servers: Servers;
	readonly policy: McpPolicy;
	readonly reconnect: (entry: ServerEntry) => Promise<unknown>;
}

function callTool(
	{ client, servers }: Wiring,
	ref: ToolRef,
	f: unknown[],
): Promise<unknown> {
	const name = `${ref.server}/${ref.tool}`;
	const entry = entryOf(servers, ref.server);
	if (entry === undefined)
		throw new EvalException("MCP server not loaded", ref.server, false);
	if (entry.state !== "loaded")
		throw new EvalException(
			`${ref.server} is not connected (${entry.reason ?? "failed"}); load it again with (load-mcp "${ref.server}")`,
			name,
			false,
		);
	const tool = entry.tools.find((t) => t.name === ref.tool);
	if (tool === undefined)
		throw new EvalException("MCP tool not loaded", name, false);
	const args = plistToJson(f[0] as List);
	validate(tool, args);
	return withTimeout(
		client.callTool({ serverId: entry.serverId, tool: tool.name, args }),
		CALL_TIMEOUT_MS,
		name,
	).then(jsonToLisp);
}

function toolBuiltIn(wiring: Wiring, ref: ToolRef): unknown {
	return wiring.interp.makeBuiltIn(
		`${ref.server}/${ref.tool}`,
		-1,
		(f: unknown[]) => {
			const entry = entryOf(wiring.servers, ref.server);
			return entry?.state === "dormant"
				? wiring.reconnect(entry).then(() => callTool(wiring, ref, f))
				: callTool(wiring, ref, f);
		},
		{ tag: TOOL_TAG, data: ref },
	);
}

function defineTools(
	wiring: Wiring,
	name: string,
	all: readonly Tool[],
): Tool[] {
	const { interp, policy } = wiring;
	const tools = all.filter((tool) => policy.tool(name, tool.name));
	for (const tool of tools)
		interp.defineGlobal(
			newSym(`${name}/${tool.name}`),
			toolBuiltIn(wiring, { server: name, tool: tool.name }),
			{
				signature: toolSignature(`${name}/${tool.name}`, tool),
				doc: toolDocBody(tool) || "MCP tool (no description provided).",
				args: toolArgs(tool),
			},
		);
	return tools;
}

function putEntry(servers: Servers, entry: ServerEntry): void {
	servers.set([...servers.get().filter((e) => e.name !== entry.name), entry]);
}

function installServer(
	wiring: Wiring,
	name: string,
	res: ConnectResult,
	args: List,
): List {
	const entry: ServerEntry = {
		name,
		serverId: res.serverId,
		state: "loaded",
		tools: defineTools(wiring, name, res.tools),
		args,
	};
	putEntry(wiring.servers, entry);
	return arrayToList(toolRows(entry));
}

function argsOf(mount: McpMount): List {
	const conf = mount.conf;
	if (conf === undefined) return arrayToList([mount.server]);
	const key = newLispKeyword;
	return arrayToList([
		key("name"),
		mount.server,
		key("url"),
		conf.url,
		...(conf.headers === undefined
			? []
			: [key("headers"), jsonToLisp(conf.headers)]),
		...(conf.oauth ? [key("oauth"), true] : []),
		...(conf.scopes === undefined
			? []
			: [key("scopes"), arrayToList(conf.scopes)]),
	]);
}

function settle<T>(
	value: T | Promise<T>,
	then: (value: T) => unknown,
): unknown {
	return value instanceof Promise ? value.then(then) : then(value);
}

function toolRow(entry: ServerEntry, tool: Tool): List {
	return arrayToList([
		newSym(`${entry.name}/${tool.name}`),
		BigInt(
			tool.inputSchema?.properties
				? Object.keys(tool.inputSchema.properties).length
				: 0,
		),
		firstLine(tool.description),
	]);
}

function toolRows(entry: ServerEntry): List[] {
	return entry.tools.map((tool) => toolRow(entry, tool));
}

interface Rebound {
	readonly bound: readonly string[];
	readonly dropped: readonly string[];
}

export type Reconcile = () => Promise<Rebound>;

function reboundText({ bound, dropped }: Rebound): string {
	const lines: string[] = [];
	if (bound.length > 0)
		lines.push(
			`MCP servers loaded elsewhere in this workspace are bound here too: ${bound.join(", ")}. Their tools are defined; (list-tools "name") lists them.`,
		);
	if (dropped.length > 0)
		lines.push(
			`MCP servers unloaded elsewhere in this workspace: ${dropped.join(", ")}. Their tools are no longer defined.`,
		);
	return lines.join("\n");
}

function reconcileEachTurn(
	hooks: SessionHooks,
	reconcilers: WeakMap<Interp, Reconcile>,
): void {
	hooks.turnStart.use(function* (ctx, next) {
		const reconcile = reconcilers.get(ctx.interp);
		if (reconcile !== undefined) {
			const text = reboundText(yield* settled(reconcile()));
			if (text !== "") ctx.emit(text);
		}
		yield* next(ctx);
	});
}

export function mcpExtension(host: McpExtensionHost): InterpExtension {
	const reconcilers = new WeakMap<Interp, Reconcile>();
	const registry = host.registry ?? memoryRegistry();
	return Object.assign(
		(interp: Interp): void => {
			reconcilers.set(interp, registerMcp(interp, { ...host, registry }));
		},
		{
			prompt: host.prompt(),
			session: (hooks: SessionHooks): void => {
				answerAuthorization(hooks);
				reconcileEachTurn(hooks, reconcilers);
			},
		},
	);
}

export function registerMcp(
	interp: Interp,
	host: Pick<McpExtensionHost, "client" | "toolkit" | "search" | "policy"> & {
		registry: McpRegistry;
	},
): Reconcile {
	const { client, toolkit, search, registry } = host;
	const policy = host.policy ?? openPolicy;

	const servers = interp.state(
		"mcp/servers",
		serverCodec,
		[],
		"The MCP servers bound in this session, each with its state (:loaded, :dormant until its next call reconnects it, or :failed), its tools and the arguments it was loaded with. The workspace's registry decides which servers are loaded; this is the session's copy, brought in line with it at every turn. Read it, never set it.",
	);
	const loadedServer: DocArgSpec = {
		name: "server",
		type: "string",
		required: true,
		description: "A loaded MCP server.",
		values: () =>
			servers.get().map((entry) => ({
				value: entry.name,
				description: `${entry.tools.length} tools, ${entry.state}`,
			})),
	};
	const predefined = new Map<string, ConnConfig>();
	const loading = new Set<LispPromise>();
	for (const conf of toolkit.all())
		if (policy.server(conf.name).access !== "hidden")
			predefined.set(conf.name, conf);

	function admit(conf: ConnConfig): void {
		const access = policy.server(conf.name);
		if (access.access === "hidden")
			throw new EvalException("unknown MCP server", conf.name, false);
		if (access.access === "denied")
			throw new EvalException(
				access.reason === undefined
					? "MCP server denied"
					: `MCP server denied: ${access.reason}`,
				conf.name,
				false,
			);
	}

	function mountOf(conf: ConnConfig, tools: readonly Tool[]): McpMount {
		return predefined.get(conf.name) === conf
			? { server: conf.name, tools }
			: { server: conf.name, conf: conf as HttpConnConfig, tools };
	}

	function connect(
		args: List,
		signal: AbortSignal,
		progress?: Progress,
	): Promise<List> {
		const conf = connConfigFromArgs(args, predefined);
		admit(conf);
		return client.connect(conf, { signal, progress }).then(
			async (res) => {
				try {
					if (signal.aborted)
						throw new EvalException("MCP load cancelled", conf.name, false);
					await registry.mount(mountOf(conf, res.tools));
				} catch (error) {
					void client.disconnect(res.serverId).catch(() => {});
					throw error;
				}
				return installServer(wiring, conf.name, res, args);
			},
			(error: unknown) => {
				throw holdForAuthorization(interp, error);
			},
		);
	}

	function startLoad(args: List): LispPromise {
		admit(connConfigFromArgs(args, predefined));
		const promise = interp.async.start(
			(signal, progress) => connect(args, signal, progress),
			{ kind: "load-mcp", args: [args] },
		);
		loading.add(promise);
		const forget = () => loading.delete(promise);
		void interp.async.promiseOf(promise).then(forget, forget);
		return promise;
	}

	const reconnecting = new Map<string, Promise<unknown>>();

	function reconnect(entry: ServerEntry): Promise<unknown> {
		const standing = reconnecting.get(entry.name);
		if (standing !== undefined) return standing;
		const fail = (error: unknown): never => {
			servers.set(
				servers.get().map((e) =>
					e.name === entry.name
						? {
								...e,
								state: "failed",
								reason: `reconnect failed: ${error instanceof Error ? error.message : String(error)}`,
							}
						: e,
				),
			);
			throw error;
		};
		let running: Promise<unknown>;
		try {
			running = interp.async.promiseOf(startLoad(entry.args)).catch(fail);
		} catch (error) {
			running = Promise.reject(error).catch(fail);
		}
		const done = running.finally(() => reconnecting.delete(entry.name));
		reconnecting.set(entry.name, done);
		return done;
	}

	const wiring: Wiring = { interp, client, servers, policy, reconnect };

	interp.def(
		"load-mcp",
		-1,
		'(load-mcp "server") | (load-mcp :name "server")',
		'Start loading an MCP server; returns a job. (await job) connects and installs its `server/tool` bindings, then returns its tools, each as (name argument-count description) exactly as (list-tools) reports them — so there is no need to list them afterwards. A toolkit server is loaded by the name (search-mcps)/(list-toolkit) reported — (load-mcp "name") or (load-mcp :name "name"); pass :url to load an ad-hoc remote server instead.',
		z.tuple([zList]),
		([rest]) => {
			const conf = connConfigFromArgs(rest, predefined);
			if (entryOf(servers, conf.name))
				doUnload(interp, client, servers, conf.name);
			return startLoad(rest);
		},
		loadMcpArgs(predefined),
	);

	interp.def(
		"unload-mcp",
		1,
		'(unload-mcp "server")',
		"Unload an MCP server and remove its `server/tool` bindings.",
		z.tuple([zName]),
		([name]) => {
			if (entryOf(servers, name) === undefined)
				throw new EvalException("MCP server not loaded", name, false);
			return settle(registry.unmount(name), () =>
				arrayToList(
					entryOf(servers, name) === undefined
						? []
						: doUnload(interp, client, servers, name),
				),
			);
		},
		[loadedServer],
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
		'Log in to an OAuth MCP server: return :logged-in if already authenticated, otherwise ask the user to authorize it and end the turn. After they authorize, (load-mcp "server") connects.',
		z.tuple([zList]),
		([rest]) => {
			const args = listToArray(rest);
			const name = typeof args[0] === "string" ? args[0] : asName(args[0]);
			const conf = oauthServer(predefined, name);
			return withTimeout(client.login(conf), CALL_TIMEOUT_MS, "login").then(
				({ authUrl }) => {
					if (authUrl === null) return newLispKeyword("logged-in");
					throw holdForAuthorization(
						interp,
						new AuthorizationRequired(name, authUrl, false),
					);
				},
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
			const unloaded = entryOf(servers, name)
				? settle(registry.unmount(name), () => {
						if (entryOf(servers, name)) doUnload(interp, client, servers, name);
					})
				: undefined;
			return Promise.resolve(unloaded)
				.then(() => withTimeout(client.logout(conf), CALL_TIMEOUT_MS, "logout"))
				.then(() => newLispKeyword("logged-out"));
		},
	);

	interp.def(
		"list-mcps",
		0,
		"(list-mcps)",
		"Return the list of currently loaded MCP servers.",
		z.tuple([]),
		() => {
			const names = new Set<string>([
				...predefined.keys(),
				...servers.get().map((entry) => entry.name),
			]);
			const rows = [...names].map((name) =>
				arrayToList([
					name,
					statusOf(servers, name),
					BigInt(entryOf(servers, name)?.tools.length ?? 0),
				]),
			);
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
					statusOf(servers, name),
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
			const scored = searchDocuments(
				search,
				rawQuery,
				[...predefined.values()].map((conf) => ({
					value: conf,
					document: {
						id: conf.name,
						name: conf.name,
						keywords: conf.keywords,
						description: conf.description,
					},
				})),
			);
			return arrayToList(
				scored.map(({ value: conf, score }) =>
					arrayToList([
						conf.name,
						BigInt(Math.round(score)),
						firstLine(conf.description),
						statusOf(servers, conf.name),
					]),
				),
			);
		},
	);

	interp.def(
		"list-tools",
		-1,
		'(list-tools "server"...)',
		"Return the tools of the named loaded MCP servers, or of every loaded server when none is named.",
		z.tuple([zList]),
		([rest]) => {
			const names = listToArray(rest).map(asName);
			for (const name of names)
				if (entryOf(servers, name) === undefined)
					throw new EvalException("MCP server not loaded", name, false);
			const only = new Set(names);
			return arrayToList(
				servers
					.get()
					.filter((entry) => only.size === 0 || only.has(entry.name))
					.flatMap(toolRows),
			);
		},
		[{ ...loadedServer, required: false, repeats: true }],
	);

	interp.def(
		"search-tools",
		1,
		'(search-tools "query")',
		"Search the tools of all loaded MCP servers by name/description.",
		z.tuple([zName]),
		([rawQuery]) => {
			const candidates: {
				value: { sym: Sym; doc: string };
				document: SearchDocument;
			}[] = [];
			for (const entry of servers.get()) {
				for (const tool of entry.tools) {
					const sym = newSym(`${entry.name}/${tool.name}`);
					candidates.push({
						value: { sym, doc: firstLine(tool.description) },
						document: {
							id: sym.name,
							name: sym.name,
							description: tool.description,
						},
					});
				}
			}
			const scored = searchDocuments(search, rawQuery, candidates);
			return arrayToList(
				scored.map(({ value, score }) =>
					arrayToList([value.sym, BigInt(Math.round(score)), value.doc]),
				),
			);
		},
	);

	const shutdown = (): void => {
		for (const entry of servers.get()) {
			if (entry.state === "loaded")
				void client.disconnect(entry.serverId).catch(() => {});
			for (const sym of toolSyms(entry)) interp.undefineGlobal(sym);
		}
		servers.set([]);
		for (const promise of loading) interp.async.cancel(promise);
		loading.clear();
		void client.shutdown().catch(() => {});
	};

	interp.def(
		"mcp-shutdown",
		0,
		"(mcp-shutdown)",
		"Disconnect every loaded MCP server and unload its bindings.",
		z.tuple([]),
		() => {
			const names = servers.get().map((entry) => entry.name);
			const unmounted = names.map((name) => registry.unmount(name));
			return settle(
				unmounted.some((done) => done instanceof Promise)
					? Promise.all(unmounted)
					: unmounted,
				() => {
					shutdown();
					return true;
				},
			);
		},
	);

	interp.hooks.failedForm.use(function* (interp, form, error, next) {
		const reported = notLoaded(error, predefined, servers);
		if (reported === undefined) return yield* next(interp, form, error);
		return { reported };
	});

	interp.hooks.dispose.use((next) => {
		shutdown();
		next();
	});

	interp.recovery.kind({
		name: TOOL_TAG,
		restore: (data) => toolBuiltIn(wiring, data as ToolRef),
	});

	interp.recovery.resumable("load-mcp", ([args], signal) =>
		connect(args as List, signal),
	);

	interp.recovery.afterRestore("mcp/servers", () => {
		servers.set(
			servers
				.get()
				.map((entry) =>
					entry.state === "loaded"
						? { ...entry, state: "dormant", reason: "disconnected by restore" }
						: entry,
				),
		);
	});

	function bindMount(mount: McpMount): boolean {
		const entry = entryOf(servers, mount.server);
		const conf = mount.conf ?? predefined.get(mount.server);
		if (conf === undefined || policy.server(mount.server).access !== "open") {
			if (entry !== undefined) doUnload(interp, client, servers, mount.server);
			return false;
		}
		const tools = mount.tools.filter((tool) =>
			policy.tool(mount.server, tool.name),
		);
		if (
			entry !== undefined &&
			JSON.stringify(entry.tools) === JSON.stringify(tools)
		)
			return false;
		if (entry !== undefined) doUnload(interp, client, servers, mount.server);
		putEntry(servers, {
			name: mount.server,
			serverId: "",
			state: "dormant",
			reason: "loaded elsewhere in the workspace",
			tools: defineTools(wiring, mount.server, mount.tools),
			args: argsOf(mount),
		});
		return entry === undefined;
	}

	async function sleepIdle(): Promise<void> {
		const loaded = servers.get().filter((entry) => entry.state === "loaded");
		const asleep = await Promise.all(
			loaded.map((entry) => client.asleep(entry.serverId).catch(() => false)),
		);
		loaded.forEach((entry, i) => {
			const current = entryOf(servers, entry.name);
			if (
				!asleep[i] ||
				current?.state !== "loaded" ||
				current.serverId !== entry.serverId
			)
				return;
			void client.disconnect(entry.serverId).catch(() => {});
			putEntry(servers, {
				...current,
				state: "dormant",
				reason: "stopped after going unused",
			});
		});
	}

	return async () => {
		const mounts = new Map(
			(await registry.mounts()).map((mount) => [mount.server, mount]),
		);
		const dropped = servers
			.get()
			.map((entry) => entry.name)
			.filter((name) => !mounts.has(name));
		for (const name of dropped) doUnload(interp, client, servers, name);
		const bound = [...mounts.values()]
			.filter((mount) => bindMount(mount))
			.map((mount) => mount.server);
		await sleepIdle();
		return { bound, dropped };
	};
}

function oauthServer(
	predefined: Map<string, ConnConfig>,
	name: string,
): OAuthConnConfig {
	const conf = predefined.get(name);
	if (!conf || !("url" in conf || ("image" in conf && conf.oauth)))
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

function searchDocuments<T>(
	search: SearchEngine,
	query: string,
	candidates: readonly { value: T; document: SearchDocument }[],
): { value: T; score: number }[] {
	const byId = new Map(
		candidates.map((candidate) => [candidate.document.id, candidate]),
	);
	const seen = new Set<string>();
	const matches: { value: T; id: string; score: number }[] = [];
	for (const hit of search.search(
		query,
		candidates.map((candidate) => candidate.document),
	)) {
		if (!Number.isFinite(hit.score) || seen.has(hit.id)) continue;
		const candidate = byId.get(hit.id);
		if (!candidate) continue;
		seen.add(hit.id);
		matches.push({ value: candidate.value, id: hit.id, score: hit.score });
	}
	matches.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
	return matches;
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

function enumValues(spec: JsonSchema): DocValue[] | undefined {
	return spec.enum?.map((value) => ({
		value: typeof value === "string" ? value : JSON.stringify(value),
	}));
}

function toolArgs(tool: Tool): DocArg[] {
	const required = new Set(tool.inputSchema?.required ?? []);
	return orderedProps(tool).map(([key, spec]) => ({
		name: key,
		type: schemaType(spec),
		required: required.has(key),
		description: spec.description,
		values: enumValues(spec),
	}));
}

function argumentLine(
	key: string,
	spec: JsonSchema,
	required: boolean,
): string {
	const req = required ? " (required)" : "";
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
	return `  ${key}${schemaType(spec)}${req}${allowed}${dflt}${example}${desc}`;
}

function examplesBlock(
	title: string,
	examples: unknown[] | undefined,
): string[] {
	if (!examples?.length) return [];
	return ["", title, ...examples.map((ex) => `  ${JSON.stringify(ex)}`)];
}

function returnsBlock(out: JsonSchema | undefined): string[] {
	if (!out) return [];
	const outType = schemaType(out);
	const returns =
		outType || out.description
			? [
					"",
					`Returns: ${outType}${out.description ? ` — ${out.description}` : ""}`.trim(),
				]
			: [];
	return [...returns, ...examplesBlock("Example outputs:", out.examples)];
}

function toolDocBody(tool: Tool): string {
	const lines: string[] = tool.description ? [tool.description] : [];
	const entries = orderedProps(tool);
	const required = new Set(tool.inputSchema?.required ?? []);
	if (entries.length) {
		if (lines.length) lines.push("");
		lines.push("Arguments:");
		for (const [key, spec] of entries)
			lines.push(argumentLine(key, spec, required.has(key)));
	}
	lines.push(...examplesBlock("Example inputs:", tool.inputSchema?.examples));
	lines.push(...returnsBlock(tool.outputSchema));
	return lines.join("\n");
}
