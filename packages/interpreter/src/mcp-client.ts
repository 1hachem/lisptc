import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	auth,
	UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { oauthEnv } from "@repo/env/oauth";
import {
	type CallbackServer,
	createAuthCallback,
	FileOAuthStore,
	StoredOAuthProvider,
} from "./mcp-oauth.ts";

type ConnConfig =
	| {
			name: string;
			url: string;
			headers?: Record<string, string>;
			oauth?: boolean;
			scopes?: string[];
			command?: string;
			args?: string[];
			env?: Record<string, string>;
	  }
	| {
			name: string;
			command: string;
			args?: string[];
			env?: Record<string, string>;
	  };

const oauthStore = new FileOAuthStore();

function callbackPort(): number {
	return oauthEnv.LISPTC_OAUTH_CALLBACK_PORT ?? 8909;
}

function redirectUri(): string {
	return (
		oauthEnv.LISPTC_OAUTH_REDIRECT_URL ??
		`http://127.0.0.1:${callbackPort()}/callback`
	);
}

const LOCAL_START_TIMEOUT_MS = 60_000;
const LOCAL_POLL_MS = 250;
const LOCAL_STDERR_KEEP = 4096;

interface LocalServer {
	child: ReturnType<typeof spawn>;
	stderr: string;
}

const started = new Map<string, LocalServer>();

async function reachable(url: string): Promise<boolean> {
	try {
		await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });
		return true;
	} catch {
		return false;
	}
}

function startLocalServer(conf: {
	name: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
}): LocalServer {
	const child = spawn(conf.command, conf.args ?? [], {
		detached: true,
		stdio: ["ignore", "ignore", "pipe"],
		env: {
			...(process.env as Record<string, string>),
			...(conf.env ?? {}),
		},
	});
	const server: LocalServer = { child, stderr: "" };
	child.stderr?.on("data", (chunk: Buffer) => {
		server.stderr = (server.stderr + chunk.toString()).slice(
			-LOCAL_STDERR_KEEP,
		);
	});
	child.on("error", (err) => {
		server.stderr += `\n${err.message}`;
	});
	child.unref();
	return server;
}

function whyItDied(server: LocalServer): string {
	const tail = server.stderr.trim().split("\n").slice(-6).join("\n");
	return tail ? `\n${tail}` : "";
}

async function ensureLocalServer(conf: {
	name: string;
	url: string;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
}): Promise<void> {
	if (!conf.command) return;
	const origin = new URL(conf.url).origin;
	if (await reachable(origin)) return;
	let server = started.get(conf.name);
	if (!server || server.child.exitCode !== null) {
		server = startLocalServer({ ...conf, command: conf.command });
		started.set(conf.name, server);
	}
	const deadline = Date.now() + LOCAL_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await reachable(origin)) return;
		if (server.child.exitCode !== null) {
			started.delete(conf.name);
			throw new Error(
				`${conf.name}: its server exited with code ${server.child.exitCode} before ${origin} answered.${whyItDied(server)}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, LOCAL_POLL_MS));
	}
	throw new Error(
		`${conf.name}: started its server but ${origin} did not answer within ${LOCAL_START_TIMEOUT_MS / 1000}s.${whyItDied(server)}`,
	);
}

export function stopLocalServers(): void {
	for (const [name, server] of started) {
		const { pid } = server.child;
		try {
			if (pid !== undefined) process.kill(-pid, "SIGTERM");
		} catch {
			server.child.kill("SIGTERM");
		}
		started.delete(name);
	}
}

class NeedsAuthError extends Error {
	constructor(server: string, authUrl: string) {
		super(
			`authorization required for "${server}": open ${authUrl} — after approving it will be captured automatically, then run (load-mcp "${server}") again (or run (mcp-authorize "${server}" "<code>"))`,
		);
	}
}

let callbackServer: CallbackServer | undefined;
async function sharedCallbackServer(): Promise<CallbackServer | undefined> {
	if (callbackServer) return callbackServer;
	try {
		callbackServer = await createAuthCallback(
			callbackPort(),
			oauthEnv.LISPTC_OAUTH_REDIRECT_URL,
		);
	} catch {
		return undefined;
	}
	return callbackServer;
}

async function startCallbackCapture(
	serverUrl: string,
	scope: string | undefined,
	authUrl: URL,
	provider: StoredOAuthProvider,
): Promise<void> {
	const cb = await sharedCallbackServer();
	if (!cb) return;
	const state = authUrl.searchParams.get("state") ?? "";
	cb.waitForCode(state, undefined, (code) =>
		auth(provider, { serverUrl, authorizationCode: code, scope }).then(
			() => {},
		),
	).catch(() => {});
}

const clients = new Map<string, { client: Client; tools: Tool[] }>();

export type McpOp =
	| "connect"
	| "login"
	| "authorize"
	| "logout"
	| "list-tools"
	| "call-tool"
	| "disconnect"
	| "search";

export async function mcpDispatch(
	op: McpOp,
	payload: unknown,
	signal?: AbortSignal,
): Promise<unknown> {
	switch (op) {
		case "connect":
			return connect(payload as ConnConfig, signal);
		case "login":
			return login(payload as { url: string; scopes?: string[] });
		case "authorize":
			return authorize(
				payload as { url: string; code: string; scopes?: string[] },
			);
		case "logout":
			return logout(payload as { url: string });
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
			throw new Error("semantic search backend not implemented");
		default:
			throw new Error(`unknown op: ${op}`);
	}
}

async function connect(
	conf: ConnConfig,
	signal?: AbortSignal,
): Promise<{ serverId: string; tools: Tool[] }> {
	const client = new Client(
		{ name: "lisptc", version: "1.0.0" },
		{ capabilities: {} },
	);
	try {
		return await openClient(client, conf, signal);
	} catch (e) {
		await client.close().catch(() => {});
		throw e;
	}
}

async function openClient(
	client: Client,
	conf: ConnConfig,
	signal?: AbortSignal,
): Promise<{ serverId: string; tools: Tool[] }> {
	if ("url" in conf) await ensureLocalServer(conf);
	if ("url" in conf && conf.oauth) {
		const scope = conf.scopes?.length ? conf.scopes.join(" ") : undefined;
		const { provider, authUrl } = await ensureAuthorized(conf.url, scope);
		if (authUrl) throw new NeedsAuthError(conf.name, authUrl);
		const transport = new StreamableHTTPClientTransport(new URL(conf.url), {
			authProvider: provider,
		});
		try {
			await client.connect(transport, { signal });
		} catch (e) {
			if (!(e instanceof UnauthorizedError)) throw e;
			await provider.invalidateCredentials("tokens");
			const retry = await ensureAuthorized(conf.url, scope);
			throw new NeedsAuthError(conf.name, retry.authUrl ?? conf.url);
		}
	} else {
		const transport =
			"url" in conf
				? new StreamableHTTPClientTransport(new URL(conf.url), {
						requestInit: conf.headers ? { headers: conf.headers } : undefined,
					})
				: new StdioClientTransport({
						command: conf.command,
						args: conf.args ?? [],
						env: {
							...(process.env as Record<string, string>),
							...(conf.env ?? {}),
						},
					});
		await client.connect(transport, { signal });
	}
	const { tools } = await client.listTools(undefined, { signal });
	if (tools.length === 0) {
		await client.close().catch(() => {});
		throw new Error("connected but the server exposed no tools");
	}
	const serverId = randomUUID();
	clients.set(serverId, { client, tools });
	return { serverId, tools };
}

async function authorize(payload: {
	url: string;
	code: string;
	scopes?: string[];
}): Promise<{ ok: true }> {
	const scope = payload.scopes?.length ? payload.scopes.join(" ") : undefined;
	const provider = await StoredOAuthProvider.create(
		oauthStore,
		payload.url,
		redirectUri(),
		scope,
	);
	const result = await auth(provider, {
		serverUrl: payload.url,
		authorizationCode: payload.code,
		scope,
	});
	if (result !== "AUTHORIZED")
		throw new Error("authorization did not complete (unexpected redirect)");
	return { ok: true };
}

async function ensureAuthorized(
	serverUrl: string,
	scope: string | undefined,
): Promise<{ provider: StoredOAuthProvider; authUrl: string | null }> {
	const provider = await StoredOAuthProvider.create(
		oauthStore,
		serverUrl,
		redirectUri(),
		scope,
	);
	const registered = provider.clientInformation();
	if (
		registered?.redirect_uris &&
		!registered.redirect_uris.includes(redirectUri())
	) {
		await provider.invalidateCredentials("all");
	}
	if (provider.tokens()) return { provider, authUrl: null };
	await auth(provider, { serverUrl, scope });
	const authUrl = provider.authorizationUrl;
	if (!authUrl) throw new Error("no authorization URL produced");
	void startCallbackCapture(serverUrl, scope, authUrl, provider);
	return { provider, authUrl: authUrl.href };
}

async function login(payload: {
	name?: string;
	url: string;
	scopes?: string[];
	command?: string;
	args?: string[];
	env?: Record<string, string>;
}): Promise<{ authUrl: string | null }> {
	await ensureLocalServer({ name: payload.name ?? payload.url, ...payload });
	const scope = payload.scopes?.length ? payload.scopes.join(" ") : undefined;
	const { authUrl } = await ensureAuthorized(payload.url, scope);
	return { authUrl };
}

async function logout(payload: { url: string }): Promise<{ ok: true }> {
	await oauthStore.clear(new URL(payload.url).origin);
	return { ok: true };
}

async function listTools(serverId: string): Promise<Tool[]> {
	const entry = clients.get(serverId);
	if (!entry) throw new Error(`no such server: ${serverId}`);
	const { tools } = await entry.client.listTools();
	entry.tools = tools;
	return tools;
}

function asJsonDocument(text: string): unknown | undefined {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		return typeof parsed === "object" && parsed !== null ? parsed : undefined;
	} catch {
		return undefined;
	}
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
	if (result.structuredContent !== undefined) return result.structuredContent;
	const content = result.content;
	if (
		Array.isArray(content) &&
		content.length > 0 &&
		content.every((c) => c?.type === "text")
	) {
		const text = content.map((c) => (c as { text: string }).text).join("\n");
		return asJsonDocument(text) ?? text;
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

function extractText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((c): c is { type: "text"; text: string } => c?.type === "text")
		.map((c) => c.text)
		.join("\n");
}
